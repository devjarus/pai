import type { Plugin, PluginContext, Command, Migration } from "@personal-ai/core";

export { runResearchInBackground, createResearchJob, getResearchJob, listResearchJobs, clearCompletedJobs } from "./research.js";
export type { ResearchJob, ResearchContext } from "./research.js";

export const researchMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS research_jobs (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        budget_max_searches INTEGER DEFAULT 5,
        budget_max_pages INTEGER DEFAULT 3,
        searches_used INTEGER DEFAULT 0,
        pages_learned INTEGER DEFAULT 0,
        steps_log TEXT DEFAULT '[]',
        report TEXT,
        briefing_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_research_jobs_status ON research_jobs(status);
    `,
  },
];

export const researchPlugin: Plugin = {
  name: "research",
  version: "0.1.0",
  migrations: researchMigrations,
  commands(_ctx: PluginContext): Command[] {
    return [];
  },
};
