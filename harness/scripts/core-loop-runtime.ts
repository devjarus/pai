import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createStorage,
  createThread,
  knowledgeMigrations,
  memoryMigrations,
  productEventMigrations,
  threadMigrations,
  correctBelief,
  getBeliefHistory,
  listBeliefProvenance,
} from "../../packages/core/src/index.js";
import { addBeliefProvenance, createBelief } from "../../packages/core/src/memory/memory.js";
import type { AgentContext, PluginContext } from "../../packages/core/src/index.js";
import { addTask, completeTask, taskMigrations } from "../../packages/plugin-tasks/src/tasks.js";
import { listPrograms, scheduleMigrations } from "../../packages/plugin-schedules/src/index.js";
import { assistantPlugin } from "../../packages/plugin-assistant/src/index.js";

import { generateBriefing, briefingMigrations } from "../../packages/server/src/briefing.js";
import { findingsMigrations, createFinding, listFindings, unifiedSearch } from "../../packages/library/src/index.js";
import { digestRatingsMigrations, rateDigest, getAverageRating } from "../../packages/server/src/digest-ratings.js";
import {
  HarnessScenario,
  REQUIRED_SCENARIO_IDS,
  ValidationCheck,
  makeCheck,
  readYamlFile,
} from "./_shared.js";

function createHarnessContext(storage: ReturnType<typeof createStorage>): PluginContext {
  return {
    config: {
      timezone: "America/Los_Angeles",
      llm: {
        provider: "openai",
        model: "mock-model",
      },
    },
    storage,
    llm: {
      chat: async () => ({ text: "NONE" }),
      embed: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      health: async () => ({ ok: false }),
      getModel: () => {
        throw new Error("deterministic fallback should not request a model");
      },
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  } as unknown as PluginContext;
}

function createHarnessAgentContext(storage: ReturnType<typeof createStorage>, threadId: string, userMessage: string): AgentContext {
  const base = createHarnessContext(storage);
  const ctx = {
    ...base,
    userMessage,
    conversationHistory: [],
  } as unknown as AgentContext;
  (ctx as unknown as Record<string, unknown>).threadId = threadId;
  return ctx;
}

function hasStatement(assumptions: Array<{ statement: string }>, expected: string): boolean {
  const target = expected.toLowerCase();
  return assumptions.some((item) => item.statement.toLowerCase().includes(target));
}

function hasText(haystack: string[], expected: string): boolean {
  const target = expected.toLowerCase();
  return haystack.some((item) => item.toLowerCase().includes(target));
}

function assertRequiredBriefSections(
  scenarioId: string,
  blockers: string[],
  sections: Record<string, unknown>,
  expectedSections: string[],
  label: "first" | "second",
): void {
  for (const field of expectedSections) {
    const value = sections[field];
    if (Array.isArray(value) && value.length === 0) {
      blockers.push(`${scenarioId}: ${label} brief field "${field}" is empty`);
      continue;
    }
    if (value === undefined || value === null || value === "") {
      blockers.push(`${scenarioId}: ${label} brief field "${field}" is missing`);
    }
  }
}

async function runExecutableScenario(relativePath: string): Promise<ValidationCheck> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const scenario = readYamlFile<HarnessScenario>(relativePath);
  const dir = mkdtempSync(path.join(tmpdir(), `pai-harness-${scenario.id}-`));
  const storage = createStorage(dir);

  try {
    storage.migrate("memory", memoryMigrations);
    storage.migrate("tasks", taskMigrations);
    storage.migrate("knowledge", knowledgeMigrations);
    storage.migrate("threads", threadMigrations);
    storage.migrate("product_events", productEventMigrations);
    storage.migrate("schedules", scheduleMigrations);
    storage.migrate("briefing", briefingMigrations);
    storage.migrate("findings", findingsMigrations);
    storage.migrate("digest_ratings", digestRatingsMigrations);

    const ctx = createHarnessContext(storage);
    const thread = createThread(storage, {
      title: scenario.expected_program_behavior.program_title,
      agentName: "assistant",
    });
    const agentCtx = createHarnessAgentContext(storage, thread.id, scenario.initial_user_message);
    const tools = assistantPlugin.agent?.createTools?.(agentCtx) as Record<string, { execute?: (input: Record<string, unknown>) => Promise<unknown> }> | undefined;
    const programCreate = tools?.program_create;
    if (!programCreate?.execute) {
      return makeCheck(
        `runtime-scenario:${scenario.id}`,
        `Executable ${scenario.id} scenario failed.`,
        [`${scenario.id}: assistant program_create tool is unavailable in the harness context`],
        warnings,
      );
    }

    const programCreateResult = await programCreate.execute({
      title: scenario.expected_program_behavior.program_title,
      question: scenario.initial_user_message,
      family: scenario.expected_program_behavior.program_family,
      execution_mode: "research",
      interval_hours: 168,
      preferences: scenario.expected_memory_captured.preferences,
      constraints: scenario.expected_memory_captured.constraints,
      open_questions: scenario.expected_memory_captured.open_questions,
      objective: scenario.expected_program_behavior.why_recurring,
      phase: "monitor",
      delivery_mode: "change-gated",
      source_refs: [`scenario:${scenario.id}`],
    });

    if (typeof programCreateResult !== "string" || !programCreateResult.includes("Program created")) {
      blockers.push(`${scenario.id}: assistant program_create tool did not report successful Program creation`);
    }

    const initialProgram = listPrograms(storage, "active")[0];
    if (!initialProgram) {
      blockers.push(`${scenario.id}: assistant program_create did not persist an active Program`);
      return makeCheck(`runtime-scenario:${scenario.id}`, `Executable ${scenario.id} scenario failed.`, blockers, warnings);
    }
    if (initialProgram.threadId !== thread.id) {
      blockers.push(`${scenario.id}: Ask-created Program did not preserve the originating thread id`);
    }
    if (initialProgram.deliveryMode !== "change-gated") {
      blockers.push(`${scenario.id}: Program deliveryMode was not saved as change-gated`);
    }

    const staleAssumption = scenario.expected_next_brief_behavior.suppressed_old_assumptions[0]!;
    const replacementAssumption = scenario.correction_step.expected_memory_update[0]!;
    const seededBelief = createBelief(storage, {
      statement: staleAssumption,
      confidence: 0.82,
      type: "preference",
      importance: 8,
      origin: "user-said",
      correctionState: "active",
      freshnessAt: new Date().toISOString(),
    });
    addBeliefProvenance(storage, {
      beliefId: seededBelief.id,
      sourceKind: "episode",
      sourceId: `seed-${scenario.id}`,
      sourceLabel: "Harness seed",
      relation: "observed",
    });

    const linkedActionTitle = scenario.action_follow_through?.linked_action_title ?? `${scenario.expected_program_behavior.expected_actions[0]} follow-through`;
    const linkedAction = addTask(storage, {
      title: linkedActionTitle,
      description: `Follow through on ${scenario.expected_program_behavior.program_title} before the next brief.`,
      priority: "high",
      sourceType: "program",
      sourceId: initialProgram.id,
      sourceLabel: initialProgram.title,
    });

    const firstBrief = await generateBriefing(ctx);
    if (!firstBrief) {
      blockers.push(`${scenario.id}: first briefing was not generated`);
    } else {
      assertRequiredBriefSections(scenario.id, blockers, firstBrief.sections as Record<string, unknown>, scenario.expected_brief_sections, "first");
      if (!firstBrief.sections.recommendation?.summary.includes(initialProgram.title)) {
        warnings.push(`${scenario.id}: first briefing recommendation does not mention the Program title`);
      }
      if (!hasStatement(firstBrief.sections.memory_assumptions, staleAssumption)) {
        blockers.push(`${scenario.id}: first briefing does not surface the seeded belief that will later be corrected`);
      }
      if (!firstBrief.sections.recommendation?.summary.toLowerCase().includes("linked action")) {
        blockers.push(`${scenario.id}: first briefing did not prioritize the open linked action`);
      }
      if (!hasText(firstBrief.sections.next_actions.map((action) => action.title), linkedAction.title)) {
        blockers.push(`${scenario.id}: first briefing next actions do not surface the existing linked action`);
      }
    }

    const correction = await correctBelief(storage, ctx.llm, seededBelief.id, {
      statement: replacementAssumption,
      note: scenario.correction_step.user_message,
    });
    const correctionHistory = getBeliefHistory(storage, correction.invalidatedBelief.id);
    const correctionProvenance = listBeliefProvenance(storage, correction.replacementBelief.id);
    if (!correctionHistory.some((entry) => entry.change_type === "invalidated")) {
      blockers.push(`${scenario.id}: corrected belief history does not show invalidation`);
    }
    if (correctionProvenance.length === 0) {
      blockers.push(`${scenario.id}: replacement belief is missing provenance`);
    }

    completeTask(storage, linkedAction.id);

    const secondBrief = await generateBriefing(ctx);
    if (!secondBrief) {
      blockers.push(`${scenario.id}: corrected briefing was not generated`);
    } else {
      assertRequiredBriefSections(scenario.id, blockers, secondBrief.sections as Record<string, unknown>, scenario.expected_brief_sections, "second");
      if (!hasStatement(secondBrief.sections.memory_assumptions, replacementAssumption)) {
        blockers.push(`${scenario.id}: corrected briefing is missing updated assumption "${replacementAssumption}"`);
      }
      for (const suppressed of scenario.expected_next_brief_behavior.suppressed_old_assumptions) {
        if (hasStatement(secondBrief.sections.memory_assumptions, suppressed)) {
          blockers.push(`${scenario.id}: corrected briefing still surfaces suppressed assumption "${suppressed}"`);
        }
      }
      if (firstBrief && secondBrief.sections.recommendation.summary === firstBrief.sections.recommendation.summary) {
        blockers.push(`${scenario.id}: recommendation did not change after correction and linked action completion`);
      }
      if (hasText(secondBrief.sections.next_actions.map((action) => action.title), linkedAction.title)) {
        blockers.push(`${scenario.id}: corrected briefing still repeats the completed linked action`);
      }
      const secondBriefSignals = [
        ...secondBrief.sections.what_changed,
        ...secondBrief.sections.evidence.map((item) => item.detail),
      ];
      if (!hasText(secondBriefSignals, "completed recently")) {
        blockers.push(`${scenario.id}: corrected briefing does not surface the linked action completion as a change signal`);
      }
      if (!secondBrief.sections.correction_hook?.prompt) {
        blockers.push(`${scenario.id}: corrected briefing is missing a correction hook`);
      }
    }
    // --- Phase 1-3 additions: Library findings + Digest ratings ---

    // Research findings should be ingestible into Library
    const finding = createFinding(storage, {
      goal: scenario.initial_user_message,
      domain: "general",
      summary: `Research finding for ${scenario.expected_program_behavior.program_title}`,
      confidence: 0.8,
      agentName: "Researcher",
      depthLevel: "standard",
      sources: [],
      watchId: initialProgram.id,
    });
    if (!finding.id) {
      blockers.push(`${scenario.id}: failed to create research finding in Library`);
    }

    // Findings should appear in Library listing
    const findings = listFindings(storage);
    if (!findings.some((f) => f.id === finding.id)) {
      blockers.push(`${scenario.id}: created finding not found in Library listing`);
    }

    // Unified search should find the finding
    const searchResults = unifiedSearch(storage, scenario.expected_program_behavior.program_title);
    if (!searchResults.some((r) => r.sourceType === "finding")) {
      warnings.push(`${scenario.id}: unified search did not return the research finding (FTS may not match)`);
    }

    // Digest rating should persist
    if (firstBrief) {
      rateDigest(storage, firstBrief.id, 4, "Good recommendations");
      const avg = getAverageRating(storage);
      if (avg === null || avg < 1) {
        blockers.push(`${scenario.id}: digest rating was not persisted`);
      }
    }

  } catch (error) {
    blockers.push(`${scenario.id} runtime execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return makeCheck(
    `runtime-scenario:${scenario.id}`,
    blockers.length > 0
      ? `Executable ${scenario.id} scenario failed.`
      : `Executed ${scenario.id} against a real Ask-created Program, linked Action, belief correction history/provenance, and deterministic Brief runtime.`,
    blockers,
    warnings,
  );
}

export async function runExecutableCoreLoopScenarios(): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  for (const scenarioId of REQUIRED_SCENARIO_IDS) {
    checks.push(await runExecutableScenario(`harness/scenarios/${scenarioId}.yaml`));
  }
  return checks;
}
