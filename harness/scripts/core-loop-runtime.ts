import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createStorage, createThread, knowledgeMigrations, memoryMigrations, threadMigrations } from "../../packages/core/src/index.js";
import type { AgentContext, PluginContext } from "../../packages/core/src/index.js";
import { addTask, completeTask, taskMigrations } from "../../packages/plugin-tasks/src/tasks.js";
import { listPrograms, scheduleMigrations, updateProgram } from "../../packages/plugin-schedules/src/index.js";
import { assistantPlugin } from "../../packages/plugin-assistant/src/index.js";

import { generateBriefing, briefingMigrations } from "../../packages/server/src/briefing.js";
import {
  HarnessScenario,
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

function hasStatement(
  assumptions: Array<{ statement: string }>,
  expected: string,
): boolean {
  const target = expected.toLowerCase();
  return assumptions.some((item) => item.statement.toLowerCase().includes(target));
}

function hasText(haystack: string[], expected: string): boolean {
  const target = expected.toLowerCase();
  return haystack.some((item) => item.toLowerCase().includes(target));
}

export async function runExecutableCoreLoopScenario(): Promise<ValidationCheck> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const scenario = readYamlFile<HarnessScenario>("harness/scenarios/work-watch.yaml");
  const dir = mkdtempSync(path.join(tmpdir(), "pai-harness-core-loop-"));
  const storage = createStorage(dir);

  try {
    storage.migrate("memory", memoryMigrations);
    storage.migrate("tasks", taskMigrations);
    storage.migrate("knowledge", knowledgeMigrations);
    storage.migrate("threads", threadMigrations);
    storage.migrate("schedules", scheduleMigrations);
    storage.migrate("briefing", briefingMigrations);

    const ctx = createHarnessContext(storage);
    const thread = createThread(storage, {
      title: scenario.expected_program_behavior.program_title,
      agentName: "assistant",
    });
    const agentCtx = createHarnessAgentContext(storage, thread.id, scenario.initial_user_message);
    const tools = assistantPlugin.agent?.createTools?.(agentCtx) as Record<string, { execute?: (input: Record<string, unknown>) => Promise<unknown> }> | undefined;
    const programCreate = tools?.program_create;
    if (!programCreate?.execute) {
      blockers.push("work-watch: assistant program_create tool is unavailable in the harness context");
      return makeCheck(
        "runtime-scenario:work-watch",
        "Executable work-watch scenario failed.",
        blockers,
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
    });

    if (typeof programCreateResult !== "string" || !programCreateResult.includes("Program created")) {
      blockers.push("work-watch: assistant program_create tool did not report successful Program creation");
    }

    const initialProgram = listPrograms(storage, "active")[0];
    if (!initialProgram) {
      blockers.push("work-watch: assistant program_create did not persist an active Program");
      return makeCheck(
        "runtime-scenario:work-watch",
        "Executable work-watch scenario failed.",
        blockers,
        warnings,
      );
    }
    if (initialProgram.threadId !== thread.id) {
      blockers.push("work-watch: Ask-created Program did not preserve the originating thread id");
    }
    const linkedActionTitle = scenario.action_follow_through?.linked_action_title ?? "Confirm blocker owners";
    const linkedAction = addTask(storage, {
      title: linkedActionTitle,
      description: "Make sure each launch blocker has an owner and next step before the next brief.",
      priority: "high",
      sourceType: "program",
      sourceId: initialProgram.id,
      sourceLabel: initialProgram.title,
    });

    const firstBrief = await generateBriefing(ctx);
    if (!firstBrief) {
      blockers.push("work-watch: first briefing was not generated");
    } else {
      if (!firstBrief.sections.recommendation?.summary.includes(initialProgram.title)) {
        blockers.push("work-watch: first briefing recommendation does not mention the Program title");
      }
      if ((firstBrief.sections.what_changed?.length ?? 0) === 0) {
        blockers.push("work-watch: first briefing is missing what_changed content");
      }
      if ((firstBrief.sections.evidence?.length ?? 0) === 0) {
        blockers.push("work-watch: first briefing is missing evidence content");
      }
      if ((firstBrief.sections.memory_assumptions?.length ?? 0) === 0) {
        blockers.push("work-watch: first briefing is missing memory assumptions");
      }
      if ((firstBrief.sections.next_actions?.length ?? 0) === 0) {
        blockers.push("work-watch: first briefing is missing next actions");
      }
      if (!firstBrief.sections.recommendation?.summary.toLowerCase().includes("linked action")) {
        blockers.push("work-watch: first briefing did not prioritize the open linked action");
      }
      if (!hasText(firstBrief.sections.next_actions.map((action) => action.title), linkedAction.title)) {
        blockers.push("work-watch: first briefing next actions do not surface the existing linked action");
      }
    }

    const correctedProgram = updateProgram(storage, initialProgram.id, {
      preferences: [
        ...scenario.correction_step.expected_memory_update,
        ...scenario.expected_memory_captured.preferences,
      ],
      constraints: scenario.expected_memory_captured.constraints,
    });

    if (!correctedProgram) {
      blockers.push("work-watch: correction step failed to update the Program");
    }
    completeTask(storage, linkedAction.id);

    const secondBrief = await generateBriefing(ctx);
    if (!secondBrief) {
      blockers.push("work-watch: corrected briefing was not generated");
    } else {
      for (const expectedUpdate of scenario.correction_step.expected_memory_update) {
        if (!hasStatement(secondBrief.sections.memory_assumptions, expectedUpdate)) {
          blockers.push(`work-watch: corrected briefing is missing updated assumption "${expectedUpdate}"`);
        }
      }
      for (const suppressed of scenario.expected_next_brief_behavior.suppressed_old_assumptions) {
        if (hasStatement(secondBrief.sections.memory_assumptions, suppressed)) {
          blockers.push(`work-watch: corrected briefing still surfaces suppressed assumption "${suppressed}"`);
        }
      }
      if (firstBrief && secondBrief.sections.recommendation.summary === firstBrief.sections.recommendation.summary) {
        blockers.push("work-watch: recommendation did not change after linked action completion and correction");
      }
      if (!secondBrief.sections.recommendation?.summary.includes(initialProgram.title)) {
        warnings.push("work-watch: corrected briefing recommendation no longer references the Program title");
      }
      if (hasText(secondBrief.sections.next_actions.map((action) => action.title), linkedAction.title)) {
        blockers.push("work-watch: corrected briefing still repeats the completed linked action");
      }
      const secondBriefSignals = [
        ...secondBrief.sections.what_changed,
        ...secondBrief.sections.evidence.map((item) => item.detail),
      ];
      if (!hasText(secondBriefSignals, "completed recently")) {
        blockers.push("work-watch: corrected briefing does not surface the linked action completion as a change signal");
      }
      if (!secondBrief.sections.correction_hook?.prompt) {
        blockers.push("work-watch: corrected briefing is missing a correction hook");
      }
    }
  } catch (error) {
    blockers.push(`work-watch runtime execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return makeCheck(
    "runtime-scenario:work-watch",
    blockers.length > 0
      ? "Executable work-watch scenario failed."
      : "Executed work-watch against real Ask-created Program, linked Action, and Brief runtime paths using deterministic fallback generation.",
    blockers,
    warnings,
  );
}
