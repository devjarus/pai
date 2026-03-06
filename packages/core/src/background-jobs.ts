import type { BackgroundJobSourceKind, BackgroundWaitingReason, Storage, Migration } from "./types.js";
import type { ResearchResultType } from "./research-schemas.js";

// ---- Types ----

export interface BackgroundJob {
  id: string;
  type: "crawl" | "research" | "swarm";
  label: string;
  status: "pending" | "running" | "done" | "error";
  progress: string;
  startedAt: string;
  queuedAt?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  sourceKind?: BackgroundJobSourceKind;
  sourceScheduleId?: string | null;
  queuePosition?: number | null;
  waitingReason?: BackgroundWaitingReason | null;
  error?: string;
  result?: string;
  resultType?: ResearchResultType;
  structuredResult?: string;
}

interface BackgroundJobRow {
  id: string;
  type: string;
  label: string;
  status: string;
  progress: string;
  started_at: string;
  error: string | null;
  result: string | null;
  result_type: string | null;
  structured_result: string | null;
  queued_at: string | null;
  started_at_actual: string | null;
  attempt_count: number | null;
  last_attempt_at: string | null;
  source_kind: string | null;
  source_schedule_id: string | null;
  updated_at: string;
}

// ---- Migrations ----

export const backgroundJobMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS background_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        progress TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        error TEXT,
        result TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status);
    `,
  },
  {
    version: 2,
    up: `
      ALTER TABLE background_jobs ADD COLUMN result_type TEXT;
      ALTER TABLE background_jobs ADD COLUMN structured_result TEXT;
    `,
  },
  {
    version: 3,
    up: `
      ALTER TABLE background_jobs ADD COLUMN queued_at TEXT;
      ALTER TABLE background_jobs ADD COLUMN started_at_actual TEXT;
      ALTER TABLE background_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE background_jobs ADD COLUMN last_attempt_at TEXT;
      ALTER TABLE background_jobs ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE background_jobs ADD COLUMN source_schedule_id TEXT;
    `,
  },
];

// ---- Helpers ----

function rowToJob(row: BackgroundJobRow): BackgroundJob {
  return {
    id: row.id,
    type: row.type as BackgroundJob["type"],
    label: row.label,
    status: row.status as BackgroundJob["status"],
    progress: row.progress,
    startedAt: row.started_at,
    queuedAt: row.queued_at ?? row.started_at,
    ...(row.started_at_actual ? { startedAt: row.started_at_actual } : {}),
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at,
    sourceKind: (row.source_kind as BackgroundJobSourceKind | null) ?? "manual",
    sourceScheduleId: row.source_schedule_id,
    ...(row.error ? { error: row.error } : {}),
    ...(row.result ? { result: row.result } : {}),
    ...(row.result_type ? { resultType: row.result_type as BackgroundJob["resultType"] } : {}),
    ...(row.structured_result ? { structuredResult: row.structured_result } : {}),
  };
}

// ---- CRUD ----

export function upsertJob(storage: Storage, job: BackgroundJob): void {
  storage.run(
    `INSERT INTO background_jobs (id, type, label, status, progress, started_at, error, result, result_type, structured_result, queued_at, started_at_actual, attempt_count, last_attempt_at, source_kind, source_schedule_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       label = excluded.label,
       progress = excluded.progress,
       error = excluded.error,
       result = excluded.result,
       result_type = excluded.result_type,
       structured_result = excluded.structured_result,
       queued_at = COALESCE(excluded.queued_at, background_jobs.queued_at),
       started_at_actual = excluded.started_at_actual,
       attempt_count = excluded.attempt_count,
       last_attempt_at = excluded.last_attempt_at,
       source_kind = excluded.source_kind,
       source_schedule_id = excluded.source_schedule_id,
       updated_at = datetime('now')`,
    [
      job.id,
      job.type,
      job.label,
      job.status,
      job.progress,
      job.startedAt,
      job.error ?? null,
      job.result ?? null,
      job.resultType ?? null,
      job.structuredResult ?? null,
      job.queuedAt ?? job.startedAt,
      job.status === "pending" ? null : (job.startedAt ?? null),
      job.attemptCount ?? 0,
      job.lastAttemptAt ?? null,
      job.sourceKind ?? "manual",
      job.sourceScheduleId ?? null,
    ],
  );
}

export function getJob(storage: Storage, id: string): BackgroundJob | null {
  const rows = storage.query<BackgroundJobRow>(
    "SELECT * FROM background_jobs WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  return rowToJob(rows[0]!);
}

export function listJobs(storage: Storage): BackgroundJob[] {
  const rows = storage.query<BackgroundJobRow>(
    "SELECT * FROM background_jobs ORDER BY started_at DESC",
  );
  return rows.map(rowToJob);
}

export function updateJobStatus(
  storage: Storage,
  id: string,
  updates: Partial<Pick<BackgroundJob, "status" | "progress" | "error" | "result" | "resultType" | "structuredResult" | "queuedAt" | "startedAt" | "attemptCount" | "lastAttemptAt" | "sourceKind" | "sourceScheduleId">>,
): void {
  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.progress !== undefined) {
    fields.push("progress = ?");
    values.push(updates.progress);
  }
  if (updates.error !== undefined) {
    fields.push("error = ?");
    values.push(updates.error);
  }
  if (updates.result !== undefined) {
    fields.push("result = ?");
    values.push(updates.result);
  }
  if (updates.resultType !== undefined) {
    fields.push("result_type = ?");
    values.push(updates.resultType);
  }
  if (updates.structuredResult !== undefined) {
    fields.push("structured_result = ?");
    values.push(updates.structuredResult);
  }
  if (updates.queuedAt !== undefined) {
    fields.push("queued_at = ?");
    values.push(updates.queuedAt);
  }
  if (updates.startedAt !== undefined) {
    fields.push("started_at_actual = ?");
    values.push(updates.startedAt);
  }
  if (updates.attemptCount !== undefined) {
    fields.push("attempt_count = ?");
    values.push(updates.attemptCount);
  }
  if (updates.lastAttemptAt !== undefined) {
    fields.push("last_attempt_at = ?");
    values.push(updates.lastAttemptAt);
  }
  if (updates.sourceKind !== undefined) {
    fields.push("source_kind = ?");
    values.push(updates.sourceKind);
  }
  if (updates.sourceScheduleId !== undefined) {
    fields.push("source_schedule_id = ?");
    values.push(updates.sourceScheduleId);
  }

  values.push(id);
  storage.run(`UPDATE background_jobs SET ${fields.join(", ")} WHERE id = ?`, values);
}

export function cancelBackgroundJob(storage: Storage, id: string): boolean {
  const job = getJob(storage, id);
  if (!job || (job.status !== "running" && job.status !== "pending")) return false;
  storage.run(
    "UPDATE background_jobs SET status = 'error', error = 'Cancelled by user', updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  return true;
}

export function forceDeleteBackgroundJob(storage: Storage, id: string): boolean {
  const job = getJob(storage, id);
  if (!job) return false;
  storage.run("DELETE FROM background_jobs WHERE id = ?", [id]);
  return true;
}

export function recoverStaleBackgroundJobs(storage: Storage): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM background_jobs WHERE status IN ('running', 'pending')",
  )[0]?.cnt ?? 0;
  if (count > 0) {
    storage.run(
      "UPDATE background_jobs SET status = 'pending', error = NULL, progress = 'queued after restart', started_at_actual = NULL, updated_at = datetime('now') WHERE type IN ('research', 'swarm') AND status IN ('running', 'pending')",
    );
    storage.run(
      "UPDATE background_jobs SET status = 'error', error = 'Server restarted — job interrupted', updated_at = datetime('now') WHERE type = 'crawl' AND status = 'running'",
    );
  }
  return count;
}

export function cancelAllRunningBackgroundJobs(storage: Storage): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM background_jobs WHERE status IN ('running', 'pending')",
  )[0]?.cnt ?? 0;
  if (count > 0) {
    storage.run(
      "UPDATE background_jobs SET status = 'error', error = 'Server shutting down', updated_at = datetime('now') WHERE status IN ('running', 'pending')",
    );
  }
  return count;
}

export function clearCompletedBackgroundJobs(storage: Storage, olderThanMs?: number): number {
  if (olderThanMs !== undefined) {
    const cutoffIso = new Date(Date.now() - olderThanMs).toISOString();
    const count = storage.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM background_jobs WHERE status IN ('done', 'error') AND started_at < ?",
      [cutoffIso],
    )[0]?.cnt ?? 0;
    storage.run(
      "DELETE FROM background_jobs WHERE status IN ('done', 'error') AND started_at < ?",
      [cutoffIso],
    );
    return count;
  }

  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM background_jobs WHERE status IN ('done', 'error')",
  )[0]?.cnt ?? 0;
  storage.run("DELETE FROM background_jobs WHERE status IN ('done', 'error')");
  return count;
}
