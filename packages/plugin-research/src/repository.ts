import { nanoid } from "nanoid";
import type { BackgroundJobSourceKind, Storage, ResearchResultType } from "@personal-ai/core";
import { detectResearchDomain } from "@personal-ai/core";
import type { ResearchJob, ResearchJobRow } from "./types.js";

// ---- Row Mapping ----

export function mapRow(row: ResearchJobRow): ResearchJob {
  return {
    id: row.id,
    threadId: row.thread_id,
    goal: row.goal,
    status: row.status as ResearchJob["status"],
    resultType: (row.result_type as ResearchResultType) ?? "general",
    budgetMaxSearches: row.budget_max_searches,
    budgetMaxPages: row.budget_max_pages,
    searchesUsed: row.searches_used,
    pagesLearned: row.pages_learned,
    stepsLog: JSON.parse(row.steps_log) as string[],
    report: row.report,
    briefingId: row.briefing_id,
    createdAt: row.created_at,
    queuedAt: row.queued_at ?? row.created_at,
    startedAt: row.started_at,
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at,
    sourceKind: (row.source_kind as BackgroundJobSourceKind | null) ?? "manual",
    sourceScheduleId: row.source_schedule_id,
    completedAt: row.completed_at,
  };
}

// ---- Helpers ----

export function getProgramActionSummary(storage: Storage, programId: string | null): { openCount: number; completedCount: number; staleOpenCount: number } | null {
  if (!programId) return null;
  const rows = storage.query<{ status: string; created_at: string; due_date: string | null }>(
    "SELECT status, created_at, due_date FROM tasks WHERE source_type = 'program' AND source_id = ?",
    [programId],
  );
  if (rows.length === 0) {
    return { openCount: 0, completedCount: 0, staleOpenCount: 0 };
  }

  const open = rows.filter((row) => row.status === "open");
  const completed = rows.filter((row) => row.status === "done");
  const staleOpen = open.filter((row) => {
    const dueTs = row.due_date ? Date.parse(row.due_date) : Number.NaN;
    const createdTs = Date.parse(row.created_at);
    const referenceTs = Number.isFinite(dueTs) ? dueTs : createdTs;
    return Number.isFinite(referenceTs) && Date.now() - referenceTs > 3 * 24 * 60 * 60 * 1000;
  });
  return {
    openCount: open.length,
    completedCount: completed.length,
    staleOpenCount: staleOpen.length,
  };
}

// ---- Data Access ----

// Allowlist of column names that can be updated on research_jobs
const RESEARCH_JOB_COLUMNS = new Set([
  "status", "report", "result_type", "error",
  "searches_used", "pages_learned", "steps_log",
  "briefing_id", "completed_at",
  "queued_at", "started_at", "attempt_count", "last_attempt_at", "source_kind", "source_schedule_id",
]);

export function updateResearchJob(storage: Storage, id: string, fields: Record<string, unknown>): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!RESEARCH_JOB_COLUMNS.has(k)) continue;
    sets.push(`${k} = ?`);
    values.push(v);
  }
  if (sets.length === 0) return;
  storage.run(`UPDATE research_jobs SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
}

export function createResearchJob(
  storage: Storage,
  opts: { goal: string; threadId: string | null; maxSearches?: number; maxPages?: number; resultType?: ResearchResultType; sourceKind?: BackgroundJobSourceKind; sourceScheduleId?: string | null },
): string {
  const id = nanoid();
  const queuedAt = new Date().toISOString();
  // Cross-validate LLM-provided type against keyword detection to prevent misclassification
  const detected = detectResearchDomain(opts.goal);
  const detectedType = detected !== "general" ? detected : (opts.resultType ?? "general");
  storage.run(
    `INSERT INTO research_jobs (id, thread_id, goal, status, result_type, budget_max_searches, budget_max_pages, created_at, queued_at, source_kind, source_schedule_id)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, datetime('now'), ?, ?, ?)`,
    [id, opts.threadId, opts.goal, detectedType, opts.maxSearches ?? 5, opts.maxPages ?? 3, queuedAt, opts.sourceKind ?? "manual", opts.sourceScheduleId ?? null],
  );
  return id;
}

export function getResearchJob(storage: Storage, id: string): ResearchJob | null {
  const rows = storage.query<ResearchJobRow>(
    "SELECT * FROM research_jobs WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]!);
}

export function listResearchJobs(storage: Storage): ResearchJob[] {
  const rows = storage.query<ResearchJobRow>(
    "SELECT * FROM research_jobs ORDER BY created_at DESC LIMIT 50",
  );
  return rows.map(mapRow);
}

export function cancelResearchJob(storage: Storage, id: string): boolean {
  const job = getResearchJob(storage, id);
  if (!job || (job.status !== "running" && job.status !== "pending")) return false;
  storage.run(
    "UPDATE research_jobs SET status = 'failed', completed_at = datetime('now') WHERE id = ?",
    [id],
  );
  return true;
}

export function recoverStaleResearchJobs(storage: Storage): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM research_jobs WHERE status IN ('running', 'pending')",
  )[0]?.cnt ?? 0;
  if (count > 0) {
    storage.run(
      `UPDATE research_jobs
       SET status = 'pending',
           report = NULL,
           briefing_id = NULL,
           searches_used = 0,
           pages_learned = 0,
           steps_log = '[]',
           started_at = NULL,
           completed_at = NULL,
           last_attempt_at = NULL,
           attempt_count = attempt_count + 1
       WHERE status IN ('running', 'pending')`,
    );
  }
  return count;
}

export function cancelAllRunningResearchJobs(storage: Storage): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM research_jobs WHERE status IN ('running', 'pending')",
  )[0]?.cnt ?? 0;
  if (count > 0) {
    storage.run(
      "UPDATE research_jobs SET status = 'failed', completed_at = datetime('now') WHERE status IN ('running', 'pending')",
    );
  }
  return count;
}

export function clearCompletedJobs(storage: Storage): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM research_jobs WHERE status IN ('done', 'failed')",
  )[0]?.cnt ?? 0;
  storage.run("DELETE FROM research_jobs WHERE status IN ('done', 'failed')");
  return count;
}

export function listPendingResearchJobs(storage: Storage): ResearchJob[] {
  const rows = storage.query<ResearchJobRow>(
    "SELECT * FROM research_jobs WHERE status = 'pending' ORDER BY CASE source_kind WHEN 'manual' THEN 0 WHEN 'schedule' THEN 1 ELSE 2 END, queued_at ASC, created_at ASC",
  );
  return rows.map(mapRow);
}
