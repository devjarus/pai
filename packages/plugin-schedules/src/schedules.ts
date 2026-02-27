import { randomUUID } from "node:crypto";
import type { Migration, PluginContext } from "@personal-ai/core";

// --- Types ---

export interface ScheduledJob {
  id: string;
  label: string;
  type: string;
  goal: string;
  intervalHours: number;
  chatId: number | null;
  threadId: string | null;
  lastRunAt: string | null;
  nextRunAt: string;
  status: string;
  createdAt: string;
}

interface ScheduledJobRow {
  id: string;
  label: string;
  type: string;
  goal: string;
  interval_hours: number;
  chat_id: number | null;
  thread_id: string | null;
  last_run_at: string | null;
  next_run_at: string;
  status: string;
  created_at: string;
}

function rowToJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    goal: row.goal,
    intervalHours: row.interval_hours,
    chatId: row.chat_id,
    threadId: row.thread_id,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

// --- Migration ---

export const scheduleMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'research',
        goal TEXT NOT NULL,
        interval_hours INTEGER NOT NULL DEFAULT 24,
        chat_id INTEGER,
        thread_id TEXT,
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at);
    `,
  },
];

// --- Data Access ---

type Storage = PluginContext["storage"];

export function createSchedule(
  storage: Storage,
  opts: {
    label: string;
    goal: string;
    intervalHours?: number;
    startAt?: string | null;
    chatId?: number | null;
    threadId?: string | null;
  },
): ScheduledJob {
  const id = randomUUID().slice(0, 12);
  const intervalHours = opts.intervalHours ?? 24;
  // First run: at startAt if provided, otherwise interval from now
  const nextRunAt = opts.startAt
    ? new Date(opts.startAt).toISOString()
    : new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();

  storage.run(
    `INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, chat_id, thread_id, next_run_at)
     VALUES (?, ?, 'research', ?, ?, ?, ?, ?)`,
    [id, opts.label, opts.goal, intervalHours, opts.chatId ?? null, opts.threadId ?? null, nextRunAt],
  );

  return {
    id,
    label: opts.label,
    type: "research",
    goal: opts.goal,
    intervalHours,
    chatId: opts.chatId ?? null,
    threadId: opts.threadId ?? null,
    lastRunAt: null,
    nextRunAt,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

export function listSchedules(storage: Storage, status?: string): ScheduledJob[] {
  const query = status
    ? "SELECT * FROM scheduled_jobs WHERE status = ? ORDER BY created_at DESC"
    : "SELECT * FROM scheduled_jobs WHERE status != 'deleted' ORDER BY created_at DESC";
  const params = status ? [status] : [];
  return storage.query<ScheduledJobRow>(query, params).map(rowToJob);
}

export function getScheduleById(storage: Storage, id: string): ScheduledJob | null {
  const rows = storage.query<ScheduledJobRow>(
    "SELECT * FROM scheduled_jobs WHERE id = ?",
    [id],
  );
  return rows[0] ? rowToJob(rows[0]) : null;
}

export function pauseSchedule(storage: Storage, id: string): boolean {
  const result = storage.run(
    "UPDATE scheduled_jobs SET status = 'paused' WHERE id = ? AND status = 'active'",
    [id],
  );
  return result.changes > 0;
}

export function resumeSchedule(storage: Storage, id: string): boolean {
  // Recompute next_run_at from now
  const job = getScheduleById(storage, id);
  if (!job || job.status !== "paused") return false;
  const nextRunAt = new Date(Date.now() + job.intervalHours * 60 * 60 * 1000).toISOString();
  storage.run(
    "UPDATE scheduled_jobs SET status = 'active', next_run_at = ? WHERE id = ?",
    [nextRunAt, id],
  );
  return true;
}

export function deleteSchedule(storage: Storage, id: string): boolean {
  const result = storage.run(
    "UPDATE scheduled_jobs SET status = 'deleted' WHERE id = ? AND status != 'deleted'",
    [id],
  );
  return result.changes > 0;
}

export function getDueSchedules(storage: Storage): ScheduledJob[] {
  const now = new Date().toISOString();
  return storage.query<ScheduledJobRow>(
    "SELECT * FROM scheduled_jobs WHERE status = 'active' AND next_run_at <= ?",
    [now],
  ).map(rowToJob);
}

export function markScheduleRun(storage: Storage, id: string): void {
  const job = getScheduleById(storage, id);
  if (!job) return;
  const now = new Date().toISOString();
  const nextRunAt = new Date(Date.now() + job.intervalHours * 60 * 60 * 1000).toISOString();
  storage.run(
    "UPDATE scheduled_jobs SET last_run_at = ?, next_run_at = ? WHERE id = ?",
    [now, nextRunAt, id],
  );
}
