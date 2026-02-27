import type { Storage, Migration } from "./types.js";

// ---- Types ----

export interface BackgroundJob {
  id: string;
  type: "crawl" | "research";
  label: string;
  status: "running" | "done" | "error";
  progress: string;
  startedAt: string;
  error?: string;
  result?: string;
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
    ...(row.error ? { error: row.error } : {}),
    ...(row.result ? { result: row.result } : {}),
  };
}

// ---- CRUD ----

export function upsertJob(storage: Storage, job: BackgroundJob): void {
  storage.run(
    `INSERT INTO background_jobs (id, type, label, status, progress, started_at, error, result, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       progress = excluded.progress,
       error = excluded.error,
       result = excluded.result,
       updated_at = datetime('now')`,
    [job.id, job.type, job.label, job.status, job.progress, job.startedAt, job.error ?? null, job.result ?? null],
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
  updates: Partial<Pick<BackgroundJob, "status" | "progress" | "error" | "result">>,
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

  values.push(id);
  storage.run(`UPDATE background_jobs SET ${fields.join(", ")} WHERE id = ?`, values);
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
