import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createStorage, knowledgeMigrations, memoryMigrations } from "../../packages/core/src/index.js";
import type { PluginContext } from "../../packages/core/src/index.js";
import { taskMigrations } from "../../packages/plugin-tasks/src/tasks.js";
import { createProgram, scheduleMigrations, updateProgram } from "../../packages/plugin-schedules/src/index.js";

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

function hasStatement(
  assumptions: Array<{ statement: string }>,
  expected: string,
): boolean {
  const target = expected.toLowerCase();
  return assumptions.some((item) => item.statement.toLowerCase().includes(target));
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
    storage.migrate("schedules", scheduleMigrations);
    storage.migrate("briefing", briefingMigrations);

    const ctx = createHarnessContext(storage);
    const initialProgram = createProgram(storage, {
      title: scenario.expected_program_behavior.program_title,
      question: scenario.initial_user_message,
      family: scenario.expected_program_behavior.program_family as "general" | "work" | "travel" | "buying",
      executionMode: "research",
      intervalHours: 168,
      preferences: scenario.expected_memory_captured.preferences,
      constraints: scenario.expected_memory_captured.constraints,
      openQuestions: scenario.expected_memory_captured.open_questions,
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
      if (!secondBrief.sections.recommendation?.summary.includes(initialProgram.title)) {
        warnings.push("work-watch: corrected briefing recommendation no longer references the Program title");
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
      : "Executed work-watch against real Program and Brief runtime paths using deterministic fallback generation.",
    blockers,
    warnings,
  );
}
