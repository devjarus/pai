import { randomUUID } from "node:crypto";

import type { Migration, PluginContext, ReportExecution } from "@personal-ai/core";

export type ProgramFamily = "general" | "work" | "travel" | "buying";
export type ProgramPhase = "monitor" | "explore" | "decide" | "act" | "prepare";
export type ProgramDeliveryMode = "interval" | "change-gated";

export interface ProgramContext {
  family: ProgramFamily;
  preferences: string[];
  constraints: string[];
  openQuestions: string[];
}

export interface ProgramAuthoredState {
  objective: string | null;
  phase: ProgramPhase;
  deliveryMode: ProgramDeliveryMode;
  sourceRefs: string[];
}

export interface ProgramRuntimeState {
  latestBriefId: string | null;
  lastDeliveredAt: string | null;
  lastEvaluatedAt: string | null;
  lastSignalHash: string | null;
}

export interface ScheduledJob {
  id: string;
  label: string;
  type: ReportExecution;
  goal: string;
  intervalHours: number;
  chatId: number | null;
  threadId: string | null;
  lastRunAt: string | null;
  nextRunAt: string;
  status: string;
  createdAt: string;
  programContext: ProgramContext;
  authoredState: ProgramAuthoredState;
  runtimeState: ProgramRuntimeState;
}

export interface Program {
  id: string;
  title: string;
  question: string;
  family: ProgramFamily;
  executionMode: ReportExecution;
  intervalHours: number;
  chatId: number | null;
  threadId: string | null;
  lastRunAt: string | null;
  nextRunAt: string;
  status: string;
  createdAt: string;
  preferences: string[];
  constraints: string[];
  openQuestions: string[];
  objective: string | null;
  phase: ProgramPhase;
  deliveryMode: ProgramDeliveryMode;
  sourceRefs: string[];
  latestBriefId: string | null;
  lastDeliveredAt: string | null;
  lastEvaluatedAt: string | null;
  lastSignalHash: string | null;
}

export type ProgramDuplicateReason = "thread" | "equivalent";

export interface ProgramCreateResult {
  program: Program;
  created: boolean;
  duplicateReason: ProgramDuplicateReason | null;
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
  program_context_json: string | null;
  objective: string | null;
  phase: string | null;
  delivery_mode: string | null;
  source_refs_json: string | null;
  latest_brief_id: string | null;
  last_delivered_at: string | null;
  last_evaluated_at: string | null;
  last_signal_hash: string | null;
}

type Storage = PluginContext["storage"];

interface ScheduleCreateInput {
  label: string;
  goal: string;
  type?: ReportExecution;
  intervalHours?: number;
  startAt?: string | null;
  chatId?: number | null;
  threadId?: string | null;
  programContext?: Partial<ProgramContext>;
  authoredState?: Partial<ProgramAuthoredState>;
}

interface ProgramCreateInput {
  title: string;
  question: string;
  family?: ProgramFamily;
  executionMode?: ReportExecution;
  intervalHours?: number;
  startAt?: string | null;
  chatId?: number | null;
  threadId?: string | null;
  preferences?: string[];
  constraints?: string[];
  openQuestions?: string[];
  objective?: string | null;
  phase?: ProgramPhase;
  deliveryMode?: ProgramDeliveryMode;
  sourceRefs?: string[];
}

interface ProgramUpdateInput {
  title?: string;
  question?: string;
  family?: ProgramFamily;
  executionMode?: ReportExecution;
  intervalHours?: number;
  startAt?: string | null;
  preferences?: string[];
  constraints?: string[];
  openQuestions?: string[];
  objective?: string | null;
  phase?: ProgramPhase;
  deliveryMode?: ProgramDeliveryMode;
  sourceRefs?: string[];
}

interface ProgramRuntimeUpdateInput {
  latestBriefId?: string | null;
  lastDeliveredAt?: string | null;
  lastEvaluatedAt?: string | null;
  lastSignalHash?: string | null;
}

const DEFAULT_PROGRAM_CONTEXT: ProgramContext = {
  family: "general",
  preferences: [],
  constraints: [],
  openQuestions: [],
};

const DEFAULT_PROGRAM_RUNTIME_STATE: ProgramRuntimeState = {
  latestBriefId: null,
  lastDeliveredAt: null,
  lastEvaluatedAt: null,
  lastSignalHash: null,
};

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeProgramPhase(value: unknown): ProgramPhase {
  if (value === "explore" || value === "decide" || value === "act" || value === "prepare") {
    return value;
  }
  return "monitor";
}

function normalizeProgramDeliveryMode(value: unknown): ProgramDeliveryMode {
  return value === "change-gated" ? "change-gated" : "interval";
}

function normalizeProgramContext(input?: Partial<ProgramContext> | null): ProgramContext {
  return {
    family: input?.family ?? DEFAULT_PROGRAM_CONTEXT.family,
    preferences: toStringList(input?.preferences),
    constraints: toStringList(input?.constraints),
    openQuestions: toStringList(input?.openQuestions),
  };
}

function normalizeProgramAuthoredState(input?: Partial<ProgramAuthoredState> | null): ProgramAuthoredState {
  const objective = typeof input?.objective === "string" ? input.objective.trim() : "";
  return {
    objective: objective.length > 0 ? objective : null,
    phase: normalizeProgramPhase(input?.phase),
    deliveryMode: normalizeProgramDeliveryMode(input?.deliveryMode),
    sourceRefs: toStringList(input?.sourceRefs),
  };
}

function parseProgramContext(raw: string | null): ProgramContext {
  if (!raw) return DEFAULT_PROGRAM_CONTEXT;
  try {
    return normalizeProgramContext(JSON.parse(raw) as Partial<ProgramContext>);
  } catch {
    return DEFAULT_PROGRAM_CONTEXT;
  }
}

function rowToJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    label: row.label,
    type: row.type as ReportExecution,
    goal: row.goal,
    intervalHours: row.interval_hours,
    chatId: row.chat_id,
    threadId: row.thread_id,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    status: row.status,
    createdAt: row.created_at,
    programContext: parseProgramContext(row.program_context_json),
    authoredState: normalizeProgramAuthoredState({
      objective: row.objective,
      phase: (row.phase ?? undefined) as ProgramPhase | undefined,
      deliveryMode: (row.delivery_mode ?? undefined) as ProgramDeliveryMode | undefined,
      sourceRefs: (() => {
        if (!row.source_refs_json) return [];
        try {
          return JSON.parse(row.source_refs_json) as string[];
        } catch {
          return [];
        }
      })(),
    }),
    runtimeState: {
      latestBriefId: row.latest_brief_id,
      lastDeliveredAt: row.last_delivered_at,
      lastEvaluatedAt: row.last_evaluated_at,
      lastSignalHash: row.last_signal_hash,
    },
  };
}

function jobToProgram(job: ScheduledJob): Program {
  return {
    id: job.id,
    title: job.label,
    question: job.goal,
    family: job.programContext.family,
    executionMode: job.type,
    intervalHours: job.intervalHours,
    chatId: job.chatId,
    threadId: job.threadId,
    lastRunAt: job.lastRunAt,
    nextRunAt: job.nextRunAt,
    status: job.status,
    createdAt: job.createdAt,
    preferences: job.programContext.preferences,
    constraints: job.programContext.constraints,
    openQuestions: job.programContext.openQuestions,
    objective: job.authoredState.objective,
    phase: job.authoredState.phase,
    deliveryMode: job.authoredState.deliveryMode,
    sourceRefs: job.authoredState.sourceRefs,
    latestBriefId: job.runtimeState.latestBriefId,
    lastDeliveredAt: job.runtimeState.lastDeliveredAt,
    lastEvaluatedAt: job.runtimeState.lastEvaluatedAt,
    lastSignalHash: job.runtimeState.lastSignalHash,
  };
}

function normalizeProgramKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function findDuplicateProgram(storage: Storage, opts: ProgramCreateInput): Program | null {
  const candidates = listPrograms(storage).filter((program) => program.status !== "deleted");
  const normalizedQuestion = normalizeProgramKey(opts.question);
  const normalizedTitle = normalizeProgramKey(opts.title);

  for (const candidate of candidates) {
    if (opts.threadId && candidate.threadId && candidate.threadId === opts.threadId) {
      return candidate;
    }

    const candidateQuestion = normalizeProgramKey(candidate.question);
    const candidateTitle = normalizeProgramKey(candidate.title);
    const sameExecution = (opts.executionMode ?? "research") === candidate.executionMode;

    if (sameExecution && candidateQuestion === normalizedQuestion && candidateTitle === normalizedTitle) {
      return candidate;
    }
  }

  return null;
}

function duplicateReasonForProgram(candidate: Program, opts: ProgramCreateInput): ProgramDuplicateReason {
  if (opts.threadId && candidate.threadId && candidate.threadId === opts.threadId) {
    return "thread";
  }
  return "equivalent";
}

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
  {
    version: 2,
    up: `
      ALTER TABLE scheduled_jobs ADD COLUMN program_context_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 3,
    up: `
      ALTER TABLE scheduled_jobs ADD COLUMN objective TEXT;
      ALTER TABLE scheduled_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT 'monitor';
      ALTER TABLE scheduled_jobs ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'interval';
      ALTER TABLE scheduled_jobs ADD COLUMN source_refs_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE scheduled_jobs ADD COLUMN latest_brief_id TEXT;
      ALTER TABLE scheduled_jobs ADD COLUMN last_delivered_at TEXT;
      ALTER TABLE scheduled_jobs ADD COLUMN last_evaluated_at TEXT;
      ALTER TABLE scheduled_jobs ADD COLUMN last_signal_hash TEXT;
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_thread ON scheduled_jobs(thread_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_latest_brief ON scheduled_jobs(latest_brief_id);
    `,
  },
];

export function createSchedule(storage: Storage, opts: ScheduleCreateInput): ScheduledJob {
  const id = randomUUID().slice(0, 12);
  const type = opts.type ?? "research";
  const intervalHours = opts.intervalHours ?? 24;
  const nextRunAt = opts.startAt
    ? new Date(opts.startAt).toISOString()
    : new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();
  const programContext = normalizeProgramContext(opts.programContext);
  const authoredState = normalizeProgramAuthoredState(opts.authoredState);

  storage.run(
    `INSERT INTO scheduled_jobs (
      id, label, type, goal, interval_hours, chat_id, thread_id, next_run_at, program_context_json,
      objective, phase, delivery_mode, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.label,
      type,
      opts.goal,
      intervalHours,
      opts.chatId ?? null,
      opts.threadId ?? null,
      nextRunAt,
      JSON.stringify(programContext),
      authoredState.objective,
      authoredState.phase,
      authoredState.deliveryMode,
      JSON.stringify(authoredState.sourceRefs),
    ],
  );

  return {
    id,
    label: opts.label,
    type,
    goal: opts.goal,
    intervalHours,
    chatId: opts.chatId ?? null,
    threadId: opts.threadId ?? null,
    lastRunAt: null,
    nextRunAt,
    status: "active",
    createdAt: new Date().toISOString(),
    programContext,
    authoredState,
    runtimeState: DEFAULT_PROGRAM_RUNTIME_STATE,
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

export function recordProgramEvaluation(storage: Storage, id: string, updates: ProgramRuntimeUpdateInput): Program | null {
  const existing = getProgramById(storage, id);
  if (!existing) return null;

  storage.run(
    `UPDATE scheduled_jobs
     SET latest_brief_id = ?, last_delivered_at = ?, last_evaluated_at = ?, last_signal_hash = ?
     WHERE id = ?`,
    [
      updates.latestBriefId !== undefined ? updates.latestBriefId : existing.latestBriefId,
      updates.lastDeliveredAt !== undefined ? updates.lastDeliveredAt : existing.lastDeliveredAt,
      updates.lastEvaluatedAt !== undefined ? updates.lastEvaluatedAt : existing.lastEvaluatedAt,
      updates.lastSignalHash !== undefined ? updates.lastSignalHash : existing.lastSignalHash,
      id,
    ],
  );

  return getProgramById(storage, id);
}

export function createProgram(storage: Storage, opts: ProgramCreateInput): Program {
  return ensureProgram(storage, opts).program;
}

export function ensureProgram(storage: Storage, opts: ProgramCreateInput): ProgramCreateResult {
  const duplicate = findDuplicateProgram(storage, opts);
  if (duplicate) {
    return {
      program: duplicate,
      created: false,
      duplicateReason: duplicateReasonForProgram(duplicate, opts),
    };
  }

  return {
    program: jobToProgram(createSchedule(storage, {
      label: opts.title,
      goal: opts.question,
      type: opts.executionMode,
      intervalHours: opts.intervalHours,
      startAt: opts.startAt,
      chatId: opts.chatId,
      threadId: opts.threadId,
      programContext: {
        family: opts.family,
        preferences: opts.preferences,
        constraints: opts.constraints,
        openQuestions: opts.openQuestions,
      },
      authoredState: {
        objective: opts.objective ?? null,
        phase: opts.phase,
        deliveryMode: opts.deliveryMode,
        sourceRefs: opts.sourceRefs,
      },
    })),
    created: true,
    duplicateReason: null,
  };
}

export function listPrograms(storage: Storage, status?: string): Program[] {
  return listSchedules(storage, status).map(jobToProgram);
}

export function getProgramById(storage: Storage, id: string): Program | null {
  const job = getScheduleById(storage, id);
  return job ? jobToProgram(job) : null;
}

export function updateProgram(storage: Storage, id: string, updates: ProgramUpdateInput): Program | null {
  const existing = getProgramById(storage, id);
  if (!existing) return null;

  const intervalHours = updates.intervalHours ?? existing.intervalHours;
  const nextRunAt = updates.startAt
    ? new Date(updates.startAt).toISOString()
    : updates.intervalHours !== undefined
      ? new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString()
      : existing.nextRunAt;
  const nextContext = normalizeProgramContext({
    family: updates.family ?? existing.family,
    preferences: updates.preferences ?? existing.preferences,
    constraints: updates.constraints ?? existing.constraints,
    openQuestions: updates.openQuestions ?? existing.openQuestions,
  });
  const nextAuthored = normalizeProgramAuthoredState({
    objective: updates.objective !== undefined ? updates.objective : existing.objective,
    phase: updates.phase ?? existing.phase,
    deliveryMode: updates.deliveryMode ?? existing.deliveryMode,
    sourceRefs: updates.sourceRefs ?? existing.sourceRefs,
  });

  storage.run(
    `UPDATE scheduled_jobs
     SET label = ?, goal = ?, type = ?, interval_hours = ?, next_run_at = ?, program_context_json = ?,
         objective = ?, phase = ?, delivery_mode = ?, source_refs_json = ?
     WHERE id = ?`,
    [
      updates.title ?? existing.title,
      updates.question ?? existing.question,
      updates.executionMode ?? existing.executionMode,
      intervalHours,
      nextRunAt,
      JSON.stringify(nextContext),
      nextAuthored.objective,
      nextAuthored.phase,
      nextAuthored.deliveryMode,
      JSON.stringify(nextAuthored.sourceRefs),
      id,
    ],
  );

  return getProgramById(storage, id);
}

export function pauseProgram(storage: Storage, id: string): boolean {
  return pauseSchedule(storage, id);
}

export function resumeProgram(storage: Storage, id: string): boolean {
  return resumeSchedule(storage, id);
}

export function deleteProgram(storage: Storage, id: string): boolean {
  return deleteSchedule(storage, id);
}
