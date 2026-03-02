import type { Plugin, PluginContext, Command, Migration, Storage } from "@personal-ai/core";
import { detectResearchDomain } from "@personal-ai/core";
import { nanoid } from "nanoid";

export { runSwarmInBackground } from "./swarm.js";
export type { SwarmContext } from "./swarm.js";

// ---- Types ----

export interface SwarmJob {
  id: string;
  threadId: string | null;
  goal: string;
  resultType: string;
  plan: SwarmPlanItem[] | null;
  status: "pending" | "planning" | "running" | "synthesizing" | "done" | "failed";
  agentCount: number;
  agentsDone: number;
  synthesis: string | null;
  briefingId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SwarmPlanItem {
  role: "researcher" | "coder" | "analyst";
  task: string;
  tools: string[];
}

export interface SwarmAgent {
  id: string;
  swarmId: string;
  role: string;
  task: string;
  tools: string[];
  status: "pending" | "running" | "done" | "failed";
  result: string | null;
  error: string | null;
  stepsUsed: number;
  createdAt: string;
  completedAt: string | null;
}

export interface SwarmBlackboardEntry {
  id: string;
  swarmId: string;
  agentId: string;
  type: "finding" | "question" | "answer" | "artifact";
  content: string;
  createdAt: string;
}

// ---- Row types ----

interface SwarmJobRow {
  id: string;
  thread_id: string | null;
  goal: string;
  result_type: string;
  plan: string | null;
  status: string;
  agent_count: number;
  agents_done: number;
  synthesis: string | null;
  briefing_id: string | null;
  created_at: string;
  completed_at: string | null;
}

interface SwarmAgentRow {
  id: string;
  swarm_id: string;
  role: string;
  task: string;
  tools: string;
  status: string;
  result: string | null;
  error: string | null;
  steps_used: number;
  created_at: string;
  completed_at: string | null;
}

interface SwarmBlackboardRow {
  id: string;
  swarm_id: string;
  agent_id: string;
  type: string;
  content: string;
  created_at: string;
}

// ---- Migrations ----

export const swarmMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS swarm_jobs (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        goal TEXT NOT NULL,
        plan TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        agent_count INTEGER DEFAULT 0,
        agents_done INTEGER DEFAULT 0,
        synthesis TEXT,
        briefing_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_swarm_jobs_status ON swarm_jobs(status);

      CREATE TABLE IF NOT EXISTS swarm_agents (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL REFERENCES swarm_jobs(id),
        role TEXT NOT NULL,
        task TEXT NOT NULL,
        tools TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        error TEXT,
        steps_used INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_swarm_agents_swarm ON swarm_agents(swarm_id);

      CREATE TABLE IF NOT EXISTS swarm_blackboard (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL REFERENCES swarm_jobs(id),
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_swarm_blackboard_swarm ON swarm_blackboard(swarm_id);
    `,
  },
  {
    version: 2,
    up: `ALTER TABLE swarm_jobs ADD COLUMN result_type TEXT NOT NULL DEFAULT 'general';`,
  },
];

// ---- Data Access ----

export function createSwarmJob(
  storage: Storage,
  opts: { goal: string; threadId: string | null; resultType?: string },
): string {
  const id = nanoid();
  // Cross-validate LLM-provided type against keyword detection to prevent misclassification
  let resultType = opts.resultType ?? "general";
  const detected = detectResearchDomain(opts.goal);
  if (detected !== "general" && resultType !== detected) {
    // Keyword detection found a specific domain that differs from LLM's choice — prefer detected
    resultType = detected;
  }
  storage.run(
    `INSERT INTO swarm_jobs (id, thread_id, goal, result_type, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'))`,
    [id, opts.threadId, opts.goal, resultType],
  );
  return id;
}

export function getSwarmJob(storage: Storage, id: string): SwarmJob | null {
  const rows = storage.query<SwarmJobRow>(
    "SELECT * FROM swarm_jobs WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return rowToSwarmJob(row);
}

export function listSwarmJobs(storage: Storage): SwarmJob[] {
  const rows = storage.query<SwarmJobRow>(
    "SELECT * FROM swarm_jobs ORDER BY created_at DESC LIMIT 50",
  );
  return rows.map(rowToSwarmJob);
}

export function cancelSwarmJob(storage: Storage, id: string): boolean {
  const job = getSwarmJob(storage, id);
  if (!job || (job.status !== "running" && job.status !== "pending" && job.status !== "planning" && job.status !== "synthesizing")) return false;
  storage.run(
    "UPDATE swarm_jobs SET status = 'failed', completed_at = datetime('now') WHERE id = ?",
    [id],
  );
  // Mark any running agents as failed too
  storage.run(
    "UPDATE swarm_agents SET status = 'failed', error = 'Job cancelled by user', completed_at = datetime('now') WHERE swarm_id = ? AND status IN ('pending', 'running')",
    [id],
  );
  return true;
}

export function recoverStaleSwarmJobs(storage: Storage): number {
  const activeStatuses = "('pending', 'planning', 'running', 'synthesizing')";
  const count = storage.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM swarm_jobs WHERE status IN ${activeStatuses}`,
  )[0]?.cnt ?? 0;
  if (count > 0) {
    storage.run(
      `UPDATE swarm_agents SET status = 'failed', error = 'Server restarted — job interrupted', completed_at = datetime('now') WHERE swarm_id IN (SELECT id FROM swarm_jobs WHERE status IN ${activeStatuses}) AND status IN ('pending', 'running')`,
    );
    storage.run(
      `UPDATE swarm_jobs SET status = 'failed', completed_at = datetime('now') WHERE status IN ${activeStatuses}`,
    );
  }
  return count;
}

export function cancelAllRunningSwarmJobs(storage: Storage): number {
  const activeStatuses = "('pending', 'planning', 'running', 'synthesizing')";
  const count = storage.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM swarm_jobs WHERE status IN ${activeStatuses}`,
  )[0]?.cnt ?? 0;
  if (count > 0) {
    storage.run(
      `UPDATE swarm_agents SET status = 'failed', error = 'Server shutting down', completed_at = datetime('now') WHERE swarm_id IN (SELECT id FROM swarm_jobs WHERE status IN ${activeStatuses}) AND status IN ('pending', 'running')`,
    );
    storage.run(
      `UPDATE swarm_jobs SET status = 'failed', completed_at = datetime('now') WHERE status IN ${activeStatuses}`,
    );
  }
  return count;
}

export function clearCompletedSwarmJobs(storage: Storage): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM swarm_jobs WHERE status IN ('done', 'failed')",
  )[0]?.cnt ?? 0;
  // Delete blackboard and agents first (FK), then jobs
  storage.run(
    "DELETE FROM swarm_blackboard WHERE swarm_id IN (SELECT id FROM swarm_jobs WHERE status IN ('done', 'failed'))",
  );
  storage.run(
    "DELETE FROM swarm_agents WHERE swarm_id IN (SELECT id FROM swarm_jobs WHERE status IN ('done', 'failed'))",
  );
  storage.run("DELETE FROM swarm_jobs WHERE status IN ('done', 'failed')");
  return count;
}

export function updateSwarmJob(storage: Storage, id: string, fields: Record<string, unknown>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(fields);
  storage.run(`UPDATE swarm_jobs SET ${sets} WHERE id = ?`, [...values, id]);
}

export function insertSwarmAgent(
  storage: Storage,
  agent: { id: string; swarmId: string; role: string; task: string; tools: string[] },
): void {
  storage.run(
    `INSERT INTO swarm_agents (id, swarm_id, role, task, tools, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    [agent.id, agent.swarmId, agent.role, agent.task, JSON.stringify(agent.tools)],
  );
}

export function updateSwarmAgent(storage: Storage, id: string, fields: Record<string, unknown>): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(fields);
  storage.run(`UPDATE swarm_agents SET ${sets} WHERE id = ?`, [...values, id]);
}

export function getSwarmAgents(storage: Storage, swarmId: string): SwarmAgent[] {
  const rows = storage.query<SwarmAgentRow>(
    "SELECT * FROM swarm_agents WHERE swarm_id = ? ORDER BY created_at",
    [swarmId],
  );
  return rows.map(rowToSwarmAgent);
}

export function insertBlackboardEntry(
  storage: Storage,
  entry: { swarmId: string; agentId: string; type: string; content: string },
): string {
  const id = nanoid();
  storage.run(
    `INSERT INTO swarm_blackboard (id, swarm_id, agent_id, type, content, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [id, entry.swarmId, entry.agentId, entry.type, entry.content],
  );
  return id;
}

export function getBlackboardEntries(storage: Storage, swarmId: string): SwarmBlackboardEntry[] {
  const rows = storage.query<SwarmBlackboardRow>(
    "SELECT * FROM swarm_blackboard WHERE swarm_id = ? ORDER BY created_at",
    [swarmId],
  );
  return rows.map((row) => ({
    id: row.id,
    swarmId: row.swarm_id,
    agentId: row.agent_id,
    type: row.type as SwarmBlackboardEntry["type"],
    content: row.content,
    createdAt: row.created_at,
  }));
}

// ---- Row mappers ----

function rowToSwarmJob(row: SwarmJobRow): SwarmJob {
  return {
    id: row.id,
    threadId: row.thread_id,
    goal: row.goal,
    resultType: row.result_type,
    plan: row.plan ? (JSON.parse(row.plan) as SwarmPlanItem[]) : null,
    status: row.status as SwarmJob["status"],
    agentCount: row.agent_count,
    agentsDone: row.agents_done,
    synthesis: row.synthesis,
    briefingId: row.briefing_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function rowToSwarmAgent(row: SwarmAgentRow): SwarmAgent {
  return {
    id: row.id,
    swarmId: row.swarm_id,
    role: row.role,
    task: row.task,
    tools: JSON.parse(row.tools) as string[],
    status: row.status as SwarmAgent["status"],
    result: row.result,
    error: row.error,
    stepsUsed: row.steps_used,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ---- Plugin ----

export const swarmPlugin: Plugin = {
  name: "swarm",
  version: "0.1.0",
  migrations: swarmMigrations,
  commands(_ctx: PluginContext): Command[] {
    return [];
  },
};
