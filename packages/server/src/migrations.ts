import { memoryMigrations, threadMigrations, knowledgeMigrations, authMigrations, backgroundJobMigrations, artifactMigrations, agentRegistryMigrations } from "@personal-ai/core";
import type { Storage, Migration } from "@personal-ai/core";
import { taskMigrations } from "@personal-ai/plugin-tasks";
import { telegramMigrations } from "@personal-ai/plugin-telegram";
import { researchMigrations } from "@personal-ai/plugin-research";
import { briefingMigrations } from "./briefing.js";
import { learningMigrations } from "./learning.js";
import { scheduleMigrations } from "@personal-ai/plugin-schedules";

/** All plugin migrations in registration order */
export const allMigrations: Array<[string, Migration[]]> = [
  ["memory", memoryMigrations],
  ["tasks", taskMigrations],
  ["threads", threadMigrations],
  ["telegram", telegramMigrations],
  ["knowledge", knowledgeMigrations],
  ["auth", authMigrations],
  ["inbox", briefingMigrations],
  ["research", researchMigrations],
  ["learning", learningMigrations],
  ["schedules", scheduleMigrations],
  ["background_jobs", backgroundJobMigrations],
  ["artifacts", artifactMigrations],
  ["agent_registry", agentRegistryMigrations],
];

/** Run all plugin migrations on a storage instance */
export function runAllMigrations(storage: Storage): void {
  for (const [name, migrations] of allMigrations) {
    storage.migrate(name, migrations);
  }
}
