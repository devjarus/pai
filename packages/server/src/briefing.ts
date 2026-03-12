import type { LanguageModel } from "ai";
import type { BackgroundJobSourceKind, Migration, PluginContext, TelemetryAttributes } from "@personal-ai/core";
import {
  listBeliefs,
  memoryStats,
  listSources,
  formatDateTime,
  getContextBudget,
  getProviderOptions,
  instrumentedGenerateText,
} from "@personal-ai/core";
import { listPrograms } from "@personal-ai/plugin-schedules";
import { listGoals, listTasks } from "@personal-ai/plugin-tasks";

const BRIEFING_LLM_TIMEOUT = {
  totalMs: 2 * 60_000,
  stepMs: 60_000,
} as const;

export interface BriefingSection {
  title?: string;
  recommendation: {
    summary: string;
    confidence: "low" | "medium" | "high";
    rationale: string;
  };
  what_changed: string[];
  evidence: Array<{
    title: string;
    detail: string;
    sourceLabel: string;
    sourceUrl?: string;
    freshness?: string;
  }>;
  memory_assumptions: Array<{
    statement: string;
    confidence: "low" | "medium" | "high";
    provenance: string;
  }>;
  next_actions: Array<{
    title: string;
    timing: string;
    detail: string;
    owner?: string;
  }>;
  correction_hook: {
    prompt: string;
  };
}

export interface BriefingBeliefInput {
  id: string;
  statement: string;
  type: string;
  confidence: number;
  updatedAt: string;
  accessCount: number;
  isNew: boolean;
  subject?: string;
}

export type BriefingTaskSourceType = "briefing" | "program";

export interface BriefingTaskInput {
  id: string;
  title: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  sourceType: BriefingTaskSourceType | null;
  sourceId: string | null;
  sourceLabel: string | null;
}

export interface BriefingCompletedTaskInput {
  title: string;
  completedAt: string | null;
  priority: string;
  createdAt: string;
  sourceType: BriefingTaskSourceType | null;
  sourceId: string | null;
  sourceLabel: string | null;
}

export interface BriefingActionSignal {
  sourceType: BriefingTaskSourceType;
  sourceId: string;
  sourceLabel: string;
  openCount: number;
  staleOpenCount: number;
  recentlyCompletedCount: number;
  highestPriorityOpen: "low" | "medium" | "high" | null;
  openTitles: string[];
  recentlyCompletedTitles: string[];
}

export interface BriefingContextInput {
  ownerName: string;
  date: string;
  time: string;
  tasks: BriefingTaskInput[];
  recentlyCompleted: BriefingCompletedTaskInput[];
  goals: Array<{ title: string }>;
  programs: BriefingProgramInput[];
  actionSignals: BriefingActionSignal[];
  beliefs: BriefingBeliefInput[];
  recentActivity: string[];
  stats: {
    totalBeliefs: number;
    avgConfidence: number;
    episodes: number;
  };
  knowledgeSources: Array<{ title: string; url: string }>;
}

export interface BriefingRow {
  id: string;
  generated_at: string;
  sections: string;
  raw_context: string | null;
  status: string;
  type: string;
  queued_at: string | null;
  started_at: string | null;
  attempt_count: number | null;
  last_attempt_at: string | null;
  source_kind: string | null;
}

export interface Briefing {
  id: string;
  generatedAt: string;
  sections: BriefingSection;
  status: string;
  type: string;
  queuedAt?: string | null;
  startedAt?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  sourceKind?: BackgroundJobSourceKind;
  rawContext?: BriefingContextInput | null;
}

export const briefingMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS briefings (
        id TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL DEFAULT (datetime('now')),
        sections TEXT NOT NULL DEFAULT '{}',
        raw_context TEXT,
        status TEXT NOT NULL DEFAULT 'ready'
      );
      CREATE INDEX IF NOT EXISTS idx_briefings_generated_at ON briefings(generated_at);
    `,
  },
  {
    version: 2,
    up: `ALTER TABLE briefings ADD COLUMN type TEXT NOT NULL DEFAULT 'daily';`,
  },
  {
    version: 3,
    up: `ALTER TABLE briefings ADD COLUMN telegram_sent_at TEXT;`,
  },
  {
    version: 4,
    up: `
      ALTER TABLE briefings ADD COLUMN queued_at TEXT;
      ALTER TABLE briefings ADD COLUMN started_at TEXT;
      ALTER TABLE briefings ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE briefings ADD COLUMN last_attempt_at TEXT;
      ALTER TABLE briefings ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'maintenance';
    `,
  },
];

function parseRawContext(rawContext: string | null): BriefingContextInput | null {
  if (!rawContext) return null;
  try {
    return JSON.parse(rawContext) as BriefingContextInput;
  } catch {
    return null;
  }
}

export function getLatestBriefing(storage: PluginContext["storage"]): Briefing | null {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 1",
    [],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
    type: row.type,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at,
    sourceKind: (row.source_kind as BackgroundJobSourceKind | null) ?? "maintenance",
  };
}

export function getBriefingById(storage: PluginContext["storage"], id: string): Briefing | null {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE id = ?",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
    type: row.type,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at,
    sourceKind: (row.source_kind as BackgroundJobSourceKind | null) ?? "maintenance",
    rawContext: parseRawContext(row.raw_context),
  };
}

export function listBriefings(storage: PluginContext["storage"]): Array<{ id: string; generatedAt: string }> {
  return storage.query<{ id: string; generated_at: string }>(
    "SELECT id, generated_at FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 30",
    [],
  ).map((row) => ({ id: row.id, generatedAt: row.generated_at }));
}

export function listAllBriefings(storage: PluginContext["storage"]): Briefing[] {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' ORDER BY generated_at DESC LIMIT 30",
    [],
  );
  return rows.map((row) => ({
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
    type: row.type,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    attemptCount: row.attempt_count ?? 0,
    lastAttemptAt: row.last_attempt_at,
    sourceKind: (row.source_kind as BackgroundJobSourceKind | null) ?? "maintenance",
  }));
}

export function clearAllBriefings(storage: PluginContext["storage"]): number {
  const count = storage.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM briefings")[0]?.cnt ?? 0;
  storage.run("DELETE FROM briefings");
  return count;
}

export function getResearchBriefings(storage: PluginContext["storage"]): Briefing[] {
  const rows = storage.query<BriefingRow>(
    "SELECT * FROM briefings WHERE status = 'ready' AND type = 'research' ORDER BY generated_at DESC LIMIT 20",
    [],
  );
  return rows.map((row) => ({
    id: row.id,
    generatedAt: row.generated_at,
    sections: JSON.parse(row.sections),
    status: row.status,
    type: row.type,
  }));
}

export function createResearchBriefing(
  storage: PluginContext["storage"],
  id: string,
  report: string,
  goal: string,
): void {
  storage.run(
    "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type) VALUES (?, datetime('now'), ?, null, 'ready', 'research')",
    [id, JSON.stringify({ report, goal })],
  );
}

export function getDailyBriefingState(storage: PluginContext["storage"]): { pending: boolean; generating: boolean; activeId: string | null } {
  const rows = storage.query<{ id: string; status: string }>(
    "SELECT id, status FROM briefings WHERE type = 'daily' AND status IN ('pending', 'generating') ORDER BY generated_at DESC LIMIT 1",
  );
  const row = rows[0];
  return {
    pending: row?.status === "pending",
    generating: row?.status === "generating",
    activeId: row?.id ?? null,
  };
}

export function enqueueBriefingGeneration(
  storage: PluginContext["storage"],
  sourceKind: BackgroundJobSourceKind = "maintenance",
): string {
  const existing = storage.query<{ id: string; status: string; source_kind: string | null }>(
    "SELECT id, status, source_kind FROM briefings WHERE type = 'daily' AND status IN ('pending', 'generating') ORDER BY generated_at DESC LIMIT 1",
  )[0];
  if (existing) {
    if (existing.status === "pending" && sourceKind === "manual" && existing.source_kind !== "manual") {
      storage.run(
        "UPDATE briefings SET source_kind = 'manual' WHERE id = ?",
        [existing.id],
      );
    }
    return existing.id;
  }

  const id = crypto.randomUUID();
  const queuedAt = new Date().toISOString();
  storage.run(
    "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type, queued_at, source_kind) VALUES (?, datetime('now'), '{}', null, 'pending', 'daily', ?, ?)",
    [id, queuedAt, sourceKind],
  );
  return id;
}

export function recoverStaleBriefings(storage: PluginContext["storage"]): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM briefings WHERE type = 'daily' AND status IN ('pending', 'generating')",
  )[0]?.cnt ?? 0;
  if (count > 0) {
    storage.run(
      `UPDATE briefings
       SET status = 'pending',
           started_at = NULL,
           last_attempt_at = NULL,
           raw_context = NULL,
           sections = '{}',
           attempt_count = CASE WHEN status = 'generating' THEN attempt_count + 1 ELSE attempt_count END
       WHERE type = 'daily' AND status IN ('pending', 'generating')`,
    );
  }
  return count;
}

export function listPendingDailyBriefings(storage: PluginContext["storage"]): Array<{ id: string; queuedAt: string; sourceKind: BackgroundJobSourceKind }> {
  return storage.query<{ id: string; queued_at: string | null; generated_at: string; source_kind: string | null }>(
    "SELECT id, queued_at, generated_at, source_kind FROM briefings WHERE type = 'daily' AND status = 'pending' ORDER BY CASE source_kind WHEN 'manual' THEN 0 WHEN 'schedule' THEN 1 ELSE 2 END, queued_at ASC, generated_at ASC",
  ).map((row) => ({
    id: row.id,
    queuedAt: row.queued_at ?? row.generated_at,
    sourceKind: (row.source_kind as BackgroundJobSourceKind | null) ?? "maintenance",
  }));
}

function pruneOldBriefings(storage: PluginContext["storage"]): void {
  storage.run(
    "DELETE FROM briefings WHERE generated_at < datetime('now', '-30 days')",
    [],
  );
}

export interface BriefingProgramInput {
  id: string;
  title: string;
  question: string;
  family: string;
  executionMode: string;
  intervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string;
  preferences: string[];
  constraints: string[];
  openQuestions: string[];
}

function confidenceLabel(value: number): "low" | "medium" | "high" {
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}

const TASK_PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const ACTION_STALE_MS: Record<string, number> = {
  high: 24 * 60 * 60 * 1000,
  medium: 3 * 24 * 60 * 60 * 1000,
  low: 7 * 24 * 60 * 60 * 1000,
};

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeTaskPriority(value: string | null | undefined): "low" | "medium" | "high" {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function compareTaskPriority(a: string | null | undefined, b: string | null | undefined): number {
  return (TASK_PRIORITY_ORDER[normalizeTaskPriority(a)] ?? 1) - (TASK_PRIORITY_ORDER[normalizeTaskPriority(b)] ?? 1);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

function dedupeEvidence(items: BriefingSection["evidence"]): BriefingSection["evidence"] {
  const seen = new Set<string>();
  const deduped: BriefingSection["evidence"] = [];
  for (const item of items) {
    const key = `${item.title.toLowerCase()}|${item.detail.toLowerCase()}|${item.sourceLabel.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function isStaleAction(task: BriefingTaskInput, now: Date): boolean {
  if (task.dueDate) {
    const dueAt = Date.parse(task.dueDate);
    if (!Number.isNaN(dueAt) && dueAt < now.getTime()) {
      return true;
    }
  }

  const createdAt = Date.parse(task.createdAt);
  if (Number.isNaN(createdAt)) return false;
  const threshold = ACTION_STALE_MS[normalizeTaskPriority(task.priority)]!;
  return now.getTime() - createdAt >= threshold;
}

function buildActionSignals(
  tasks: BriefingTaskInput[],
  recentlyCompleted: BriefingCompletedTaskInput[],
  now: Date,
): BriefingActionSignal[] {
  const grouped = new Map<string, {
    sourceType: BriefingTaskSourceType;
    sourceId: string;
    sourceLabel: string;
    openTasks: BriefingTaskInput[];
    completedTasks: BriefingCompletedTaskInput[];
  }>();

  const ensureGroup = (sourceType: BriefingTaskSourceType, sourceId: string, sourceLabel: string) => {
    const key = `${sourceType}:${sourceId}`;
    const existing = grouped.get(key);
    if (existing) return existing;
    const created = {
      sourceType,
      sourceId,
      sourceLabel,
      openTasks: [] as BriefingTaskInput[],
      completedTasks: [] as BriefingCompletedTaskInput[],
    };
    grouped.set(key, created);
    return created;
  };

  for (const task of tasks) {
    if (!task.sourceType || !task.sourceId) continue;
    const group = ensureGroup(task.sourceType, task.sourceId, task.sourceLabel ?? task.title);
    group.openTasks.push(task);
  }

  for (const task of recentlyCompleted) {
    if (!task.sourceType || !task.sourceId) continue;
    const group = ensureGroup(task.sourceType, task.sourceId, task.sourceLabel ?? task.title);
    group.completedTasks.push(task);
  }

  return [...grouped.values()]
    .map((group) => {
      const sortedOpen = [...group.openTasks].sort((left, right) =>
        compareTaskPriority(left.priority, right.priority) || Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
      const sortedCompleted = [...group.completedTasks].sort((left, right) =>
        Date.parse(right.completedAt ?? right.createdAt) - Date.parse(left.completedAt ?? left.createdAt),
      );
      return {
        sourceType: group.sourceType,
        sourceId: group.sourceId,
        sourceLabel: group.sourceLabel,
        openCount: group.openTasks.length,
        staleOpenCount: group.openTasks.filter((task) => isStaleAction(task, now)).length,
        recentlyCompletedCount: group.completedTasks.length,
        highestPriorityOpen: sortedOpen[0] ? normalizeTaskPriority(sortedOpen[0].priority) : null,
        openTitles: dedupeStrings(sortedOpen.map((task) => task.title)),
        recentlyCompletedTitles: dedupeStrings(sortedCompleted.map((task) => task.title)),
      };
    })
    .sort((left, right) => {
      const leftScore = left.staleOpenCount * 100 + left.openCount * 20 + left.recentlyCompletedCount * 8 + (left.highestPriorityOpen === "high" ? 5 : left.highestPriorityOpen === "medium" ? 2 : 0);
      const rightScore = right.staleOpenCount * 100 + right.openCount * 20 + right.recentlyCompletedCount * 8 + (right.highestPriorityOpen === "high" ? 5 : right.highestPriorityOpen === "medium" ? 2 : 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (left.sourceType !== right.sourceType) return left.sourceType === "program" ? -1 : 1;
      return left.sourceLabel.localeCompare(right.sourceLabel);
    });
}

function scoreActionSignal(signal: BriefingActionSignal | undefined): number {
  if (!signal) return 0;
  return signal.staleOpenCount * 100
    + signal.openCount * 20
    + signal.recentlyCompletedCount * 8
    + (signal.highestPriorityOpen === "high" ? 5 : signal.highestPriorityOpen === "medium" ? 2 : 0);
}

function selectPrimaryProgram(
  programs: BriefingProgramInput[],
  actionSignals: BriefingActionSignal[],
): BriefingProgramInput | undefined {
  let best: BriefingProgramInput | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const program of programs) {
    const signal = actionSignals.find((entry) => entry.sourceType === "program" && entry.sourceId === program.id);
    const score = scoreActionSignal(signal);
    if (!best || score > bestScore) {
      best = program;
      bestScore = score;
    }
  }

  return best;
}

interface BriefingActionLead {
  recommendationSummary: string;
  recommendationConfidence: "low" | "medium" | "high";
  recommendationRationale: string;
  forceRecommendation: boolean;
  whatChanged: string[];
  evidence: BriefingSection["evidence"];
  nextActions: BriefingSection["next_actions"];
  completedActionTitlesLower: string[];
}

function buildActionLead(
  rawContext: BriefingContextInput,
  primaryProgram?: BriefingProgramInput,
): BriefingActionLead | null {
  const programSignal = primaryProgram
    ? rawContext.actionSignals.find((entry) => entry.sourceType === "program" && entry.sourceId === primaryProgram.id)
    : undefined;
  const signal = programSignal ?? rawContext.actionSignals[0];
  if (!signal) return null;

  const signalLabel = programSignal && primaryProgram ? primaryProgram.title : signal.sourceLabel;
  const sourceLabel = signal.sourceType === "program" ? "Program action" : "Brief action";
  const topOpenTitle = signal.openTitles[0];
  const plural = signal.openCount === 1 ? "" : "s";
  const completedPlural = signal.recentlyCompletedCount === 1 ? "" : "s";

  if (signal.openCount > 0) {
    const recommendationSummary = primaryProgram
      ? signal.staleOpenCount > 0
        ? `Resolve the stale linked action blocking ${primaryProgram.title} before expanding the watch.`
        : `Close the open linked action for ${primaryProgram.title} before broadening the next watch.`
      : `Finish the open linked follow-through before adding more work.`;
    const recommendationRationale = primaryProgram
      ? `${signal.openCount} linked action${plural} ${signal.staleOpenCount > 0 ? "are stale or overdue" : "remain open"} for ${primaryProgram.title}. ${topOpenTitle ? `${topOpenTitle} is the clearest follow-through to close first.` : ""}`.trim()
      : `${signal.openCount} linked action${plural} ${signal.staleOpenCount > 0 ? "are stale or overdue" : "remain open"} for ${signalLabel}.`;
    return {
      recommendationSummary,
      recommendationConfidence: signal.staleOpenCount > 0 ? "high" : "medium",
      recommendationRationale,
      forceRecommendation: signal.sourceType === "program",
      whatChanged: [
        primaryProgram
          ? `${signal.openCount} linked action${plural} ${signal.staleOpenCount > 0 ? "are stale or overdue" : "remain open"} for ${primaryProgram.title}.`
          : `${signal.openCount} linked action${plural} ${signal.staleOpenCount > 0 ? "are stale or overdue" : "remain open"} for ${signalLabel}.`,
      ],
      evidence: [{
        title: signal.staleOpenCount > 0 ? "Stale linked action" : "Open linked action",
        detail: topOpenTitle
          ? `${topOpenTitle} is already tracked as follow-through for ${signalLabel}.`
          : `${signal.openCount} linked action${plural} remain open for ${signalLabel}.`,
        sourceLabel,
        freshness: signal.staleOpenCount > 0 ? `${signal.staleOpenCount} stale or overdue` : `${signal.openCount} open`,
      }],
      nextActions: [{
        title: topOpenTitle || "Close linked action",
        timing: signal.staleOpenCount > 0 ? "Now" : "Before the next brief",
        detail: topOpenTitle
          ? `${topOpenTitle} is already open for ${signalLabel}; close it or explicitly reprioritize it before adding more follow-through.`
          : `Close or reprioritize the linked follow-through for ${signalLabel} before adding more work.`,
      }],
      completedActionTitlesLower: signal.recentlyCompletedTitles.map((title) => title.toLowerCase()),
    };
  }

  if (signal.recentlyCompletedCount > 0) {
    const recentTitles = signal.recentlyCompletedTitles.slice(0, 2);
    const recommendationSummary = primaryProgram
      ? `Keep ${primaryProgram.title} on watch and wait for the next material change instead of reopening completed follow-through.`
      : `Use the recent action completion as the new baseline before adding more follow-through.`;
    return {
      recommendationSummary,
      recommendationConfidence: "medium",
      recommendationRationale: recentTitles.length > 0
        ? `${recentTitles.join(" and ")} ${signal.recentlyCompletedCount === 1 ? "was" : "were"} completed recently for ${signalLabel}, so the next brief should move forward from that completion instead of repeating it.`
        : `${signal.recentlyCompletedCount} linked action${completedPlural} were completed recently for ${signalLabel}.`,
      forceRecommendation: false,
      whatChanged: [
        `${signal.recentlyCompletedCount} linked action${completedPlural} were completed recently for ${signalLabel}.`,
      ],
      evidence: [{
        title: "Completed linked action",
        detail: recentTitles.length > 0
          ? `${recentTitles.join("; ")} ${signal.recentlyCompletedCount === 1 ? "was" : "were"} completed recently for ${signalLabel}.`
          : `${signal.recentlyCompletedCount} linked action${completedPlural} were completed recently for ${signalLabel}.`,
        sourceLabel,
        freshness: "Completed recently",
      }],
      nextActions: [{
        title: "Watch for the next material change",
        timing: "Until the next brief",
        detail: `The latest linked follow-through for ${signalLabel} is complete, so the next useful move is to capture a new blocker, external change, or decision signal.`,
      }],
      completedActionTitlesLower: signal.recentlyCompletedTitles.map((title) => title.toLowerCase()),
    };
  }

  return null;
}

function mergeActionLeadIntoBriefing(
  sections: BriefingSection,
  actionLead: BriefingActionLead | null,
): BriefingSection {
  if (!actionLead) return sections;

  const completedTitles = new Set(actionLead.completedActionTitlesLower);
  const filteredNextActions = sections.next_actions.filter((action) => !completedTitles.has(action.title.trim().toLowerCase()));
  const existingActionTitles = new Set(filteredNextActions.map((action) => action.title.trim().toLowerCase()));
  const mergedNextActions = [
    ...actionLead.nextActions.filter((action) => !existingActionTitles.has(action.title.trim().toLowerCase())),
    ...filteredNextActions,
  ].slice(0, 3);

  return {
    ...sections,
    recommendation: actionLead.forceRecommendation
      ? {
        summary: actionLead.recommendationSummary,
        confidence: actionLead.recommendationConfidence,
        rationale: actionLead.recommendationRationale,
      }
      : sections.recommendation,
    what_changed: dedupeStrings([...actionLead.whatChanged, ...sections.what_changed]).slice(0, 4),
    evidence: dedupeEvidence([...actionLead.evidence, ...sections.evidence]).slice(0, 4),
    next_actions: mergedNextActions.length > 0 ? mergedNextActions : sections.next_actions,
  };
}

function normalizeBriefingSections(raw: unknown, fallback: BriefingSection): BriefingSection {
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;
  const recommendation = value.recommendation && typeof value.recommendation === "object"
    ? value.recommendation as Record<string, unknown>
    : {};
  const correctionHook = value.correction_hook && typeof value.correction_hook === "object"
    ? value.correction_hook as Record<string, unknown>
    : {};
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "Evidence",
        detail: typeof item.detail === "string" ? item.detail : "",
        sourceLabel: typeof item.sourceLabel === "string" ? item.sourceLabel : "Observed",
        sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined,
        freshness: typeof item.freshness === "string" ? item.freshness : undefined,
      }))
      .filter((item) => item.detail.trim().length > 0)
    : [];
  const memoryAssumptions: BriefingSection["memory_assumptions"] = Array.isArray(value.memory_assumptions)
    ? value.memory_assumptions
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const confidence =
          item.confidence === "high" || item.confidence === "medium" || item.confidence === "low"
            ? item.confidence
            : "medium";
        return {
          statement: typeof item.statement === "string" ? item.statement : "",
          confidence: confidence as "low" | "medium" | "high",
          provenance: typeof item.provenance === "string" ? item.provenance : "Program context",
        };
      })
      .filter((item) => item.statement.trim().length > 0)
    : [];
  const nextActions = Array.isArray(value.next_actions)
    ? value.next_actions
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        timing: typeof item.timing === "string" ? item.timing : "Next check-in",
        detail: typeof item.detail === "string" ? item.detail : "",
        owner: typeof item.owner === "string" ? item.owner : undefined,
      }))
      .filter((item) => item.title.trim().length > 0 && item.detail.trim().length > 0)
    : [];

  return {
    title: typeof value.title === "string" ? value.title : fallback.title,
    recommendation: {
      summary: typeof recommendation.summary === "string" ? recommendation.summary : fallback.recommendation.summary,
      confidence:
        recommendation.confidence === "high" || recommendation.confidence === "medium" || recommendation.confidence === "low"
          ? recommendation.confidence
          : fallback.recommendation.confidence,
      rationale: typeof recommendation.rationale === "string" ? recommendation.rationale : fallback.recommendation.rationale,
    },
    what_changed: safeStringArray(value.what_changed).length > 0 ? safeStringArray(value.what_changed) : fallback.what_changed,
    evidence: evidence.length > 0 ? evidence : fallback.evidence,
    memory_assumptions: memoryAssumptions.length > 0 ? memoryAssumptions : fallback.memory_assumptions,
    next_actions: nextActions.length > 0 ? nextActions : fallback.next_actions,
    correction_hook: {
      prompt: typeof correctionHook.prompt === "string" ? correctionHook.prompt : fallback.correction_hook.prompt,
    },
  };
}

function buildFallbackBriefing(rawContext: BriefingContextInput): BriefingSection {
  const primaryProgram = selectPrimaryProgram(rawContext.programs, rawContext.actionSignals);
  const recentBeliefs = rawContext.beliefs.slice(0, 2);
  const actionLead = buildActionLead(rawContext, primaryProgram);
  const recommendationSummary = actionLead
    ? actionLead.recommendationSummary
    : primaryProgram
      ? `Keep ${primaryProgram.title} as the top watch for the next brief.`
      : rawContext.tasks[0]
        ? `Keep momentum on ${rawContext.tasks[0].title} before starting something new.`
        : "Keep the current watchlist active and tighten the next follow-up around the clearest open question.";
  const recommendationRationale = actionLead
    ? actionLead.recommendationRationale
    : primaryProgram
      ? `${primaryProgram.question} ${primaryProgram.constraints.length > 0 ? `Current constraints: ${primaryProgram.constraints.slice(0, 2).join("; ")}.` : ""}`.trim()
      : rawContext.tasks[0]
        ? `Keep momentum on ${rawContext.tasks[0].title} before starting something new.`
        : rawContext.recentlyCompleted.length > 0
          ? `${rawContext.recentlyCompleted.length} recent completion${rawContext.recentlyCompleted.length === 1 ? "" : "s"} give enough signal for a concise next-step brief.`
          : "This fallback brief is grounded in the stored Program, memory, and activity context.";

  const whatChanged = dedupeStrings([
    ...(actionLead?.whatChanged ?? []),
    primaryProgram
      ? `${primaryProgram.title} remains active with ${primaryProgram.intervalHours >= 24 ? "a recurring brief cadence" : "short-interval follow-through"}.`
      : "No active Program was selected, so this brief is using the strongest recent context instead.",
    rawContext.recentlyCompleted.length > 0
      ? `${rawContext.recentlyCompleted.length} recent completion${rawContext.recentlyCompleted.length === 1 ? "" : "s"} may shift the next recommendation.`
      : "There were no recent completions worth elevating into a change signal.",
    recentBeliefs.length > 0
      ? `${recentBeliefs.length} recent memory signal${recentBeliefs.length === 1 ? "" : "s"} are available for the next recommendation.`
      : "No recent memory updates were detected, so assumptions are coming from the Program definition.",
  ]).slice(0, 4);

  const evidence = dedupeEvidence([
    ...(actionLead?.evidence ?? []),
    primaryProgram
      ? {
        title: "Program definition",
        detail: primaryProgram.question,
        sourceLabel: "Program",
        freshness: `Next brief ${primaryProgram.nextRunAt}`,
      }
      : {
        title: "Observed activity",
        detail: rawContext.recentActivity[0] ?? "No recent activity was stored.",
        sourceLabel: "Activity log",
      },
    ...primaryProgram?.constraints.slice(0, 2).map((constraint) => ({
      title: "Program constraint",
      detail: constraint,
      sourceLabel: "Program",
    })) ?? [],
    ...rawContext.knowledgeSources.slice(0, 1).map((source) => ({
      title: source.title,
      detail: "Reference source available for grounding future recommendations.",
      sourceLabel: "Knowledge source",
      sourceUrl: source.url,
    })),
  ].filter((item) => item.detail.trim().length > 0));

  const memoryAssumptions = [
    ...primaryProgram?.preferences.slice(0, 2).map((preference) => ({
      statement: preference,
      confidence: "high" as const,
      provenance: "Program preference",
    })) ?? [],
    ...primaryProgram?.constraints.slice(0, 2).map((constraint) => ({
      statement: constraint,
      confidence: "high" as const,
      provenance: "Program constraint",
    })) ?? [],
    ...recentBeliefs.map((belief) => ({
      statement: belief.statement,
      confidence: confidenceLabel(belief.confidence),
      provenance: `Memory belief (${belief.type})`,
    })),
  ];

  const nextActions = [
    ...(actionLead?.nextActions ?? []),
    primaryProgram?.openQuestions[0]
      ? {
        title: "Resolve the top open question",
        timing: "Before the next brief",
        detail: primaryProgram.openQuestions[0],
      }
      : null,
    primaryProgram
      ? {
        title: "Review the Program definition",
        timing: "Now",
        detail: `Confirm that ${primaryProgram.title} still has the right priorities and constraints.`,
      }
      : null,
    rawContext.tasks[0]
      ? {
        title: "Close the most immediate task",
        timing: "Today",
        detail: `${rawContext.tasks[0].title} is the clearest actionable item in the current context.`,
      }
      : null,
  ]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.title.trim().toLowerCase() === item.title.trim().toLowerCase()) === index)
    .slice(0, 3);

  return {
    title: primaryProgram?.title ?? "Daily Briefing",
    recommendation: {
      summary: recommendationSummary,
      confidence: actionLead?.recommendationConfidence ?? (primaryProgram || rawContext.tasks.length > 0 ? "medium" : "low"),
      rationale: recommendationRationale,
    },
    what_changed: whatChanged,
    evidence: evidence.length > 0
      ? evidence
      : [{
        title: "Program context",
        detail: "No external evidence was attached, so this brief is grounded in stored product context only.",
        sourceLabel: "System",
      }],
    memory_assumptions: memoryAssumptions.length > 0
      ? memoryAssumptions
      : [{
        statement: "No durable preferences were attached to the current watch.",
        confidence: "low",
        provenance: "System fallback",
      }],
    next_actions: nextActions.length > 0
      ? nextActions
      : [{
        title: "Add a Program",
        timing: "Now",
        detail: "Create a Program so the next brief has a stable recurring object to follow.",
      }],
    correction_hook: {
      prompt: primaryProgram
        ? `Correction for ${primaryProgram.title}: tell pai what changed, what assumption is wrong, or what should matter more next time.`
        : "Correction: tell pai what assumption is wrong or what should matter more next time.",
    },
  };
}

function summarizePreviousBriefing(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  if (raw.recommendation && typeof raw.recommendation === "object") {
    const recommendation = raw.recommendation as Record<string, unknown>;
    if (typeof recommendation.summary === "string") {
      parts.push(`Recommendation: "${recommendation.summary}"`);
    }
  } else if (typeof raw.greeting === "string") {
    parts.push(`Greeting: "${raw.greeting}"`);
  }
  const changes = safeStringArray(raw.what_changed);
  if (changes.length > 0) {
    parts.push(`Changes: ${changes.join("; ")}`);
  }
  if (Array.isArray(raw.next_actions)) {
    const titles = raw.next_actions
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => item.title)
      .filter((title): title is string => typeof title === "string");
    if (titles.length > 0) parts.push(`Next actions: ${titles.join(", ")}`);
  }
  if (raw.taskFocus && typeof raw.taskFocus === "object") {
    const taskFocus = raw.taskFocus as Record<string, unknown>;
    if (Array.isArray(taskFocus.items)) {
      const titles = taskFocus.items
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => item.title)
        .filter((title): title is string => typeof title === "string");
      if (titles.length > 0) parts.push(`Tasks highlighted: ${titles.join(", ")}`);
    }
  }
  return parts.join("\n");
}

export async function generateBriefing(
  ctx: PluginContext,
  telemetry?: Pick<TelemetryAttributes, "traceId" | "runId">,
  briefingId?: string,
): Promise<Briefing | null> {
  let llmHealthy = false;
  try {
    const health = await ctx.llm.health();
    llmHealthy = health.ok;
  } catch {
    llmHealthy = false;
  }

  const tasks = listTasks(ctx.storage, "open");
  const goals = listGoals(ctx.storage).filter((goal) => goal.status === "active");
  const stats = memoryStats(ctx.storage);
  const sources = listSources(ctx.storage).slice(0, 10);
  const programs = listPrograms(ctx.storage, "active").slice(0, 10);

  const recentlyDone = listTasks(ctx.storage, "done").filter((task) => {
    if (!task.completed_at) return false;
    const age = Date.now() - new Date(task.completed_at).getTime();
    return age < 7 * 24 * 60 * 60 * 1000;
  }).slice(0, 5);

  const allBeliefs = listBeliefs(ctx.storage, "active");
  const recentBeliefs = allBeliefs
    .filter((belief) => {
      const age = Date.now() - new Date(belief.updated_at).getTime();
      return age < 3 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 15);
  const nonRecent = allBeliefs.filter((belief) => !recentBeliefs.some((recent) => recent.id === belief.id));
  for (let index = nonRecent.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nonRecent[index], nonRecent[swapIndex]] = [nonRecent[swapIndex]!, nonRecent[index]!];
  }
  const topBeliefs = recentBeliefs.length >= 10
    ? recentBeliefs
    : [...recentBeliefs, ...nonRecent.slice(0, 10 - recentBeliefs.length)];

  let recentEpisodes: Array<{ content: string; timestamp: string }> = [];
  try {
    recentEpisodes = ctx.storage.query<{ content: string; timestamp: string }>(
      "SELECT content, timestamp FROM episodes ORDER BY timestamp DESC LIMIT 10",
    );
  } catch {
    recentEpisodes = [];
  }

  let previousBriefingSummary = "";
  try {
    const prevRows = ctx.storage.query<{ sections: string }>(
      "SELECT sections FROM briefings WHERE status = 'ready' AND type = 'daily' ORDER BY generated_at DESC LIMIT 2",
    );
    previousBriefingSummary = prevRows
      .map((row) => summarizePreviousBriefing(JSON.parse(row.sections) as Record<string, unknown>))
      .filter((summary) => summary.length > 0)
      .join("\n---\n");
  } catch {
    previousBriefingSummary = "";
  }

  const now = new Date();
  let ownerName = "there";
  try {
    const ownerRow = ctx.storage.query<{ name: string | null }>(
      "SELECT name FROM owner LIMIT 1",
      [],
    );
    ownerName = ownerRow[0]?.name || "there";
  } catch {
    ownerName = "there";
  }

  const openTaskContext: BriefingTaskInput[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    dueDate: task.due_date,
    createdAt: task.created_at,
    sourceType: task.source_type,
    sourceId: task.source_id,
    sourceLabel: task.source_label,
  }));
  const completedTaskContext: BriefingCompletedTaskInput[] = recentlyDone.map((task) => ({
    title: task.title,
    completedAt: task.completed_at,
    priority: task.priority,
    createdAt: task.created_at,
    sourceType: task.source_type,
    sourceId: task.source_id,
    sourceLabel: task.source_label,
  }));
  const actionSignals = buildActionSignals(openTaskContext, completedTaskContext, now);

  const rawContext: BriefingContextInput = {
    ownerName,
    date: formatDateTime(ctx.config.timezone, now).date,
    time: formatDateTime(ctx.config.timezone, now).time,
    tasks: openTaskContext,
    recentlyCompleted: completedTaskContext,
    goals: goals.map((goal) => ({ title: goal.title })),
    programs: programs.map((program) => ({
      id: program.id,
      title: program.title,
      question: program.question,
      family: program.family,
      executionMode: program.executionMode,
      intervalHours: program.intervalHours,
      lastRunAt: program.lastRunAt,
      nextRunAt: program.nextRunAt,
      preferences: program.preferences,
      constraints: program.constraints,
      openQuestions: program.openQuestions,
    })),
    actionSignals,
    beliefs: topBeliefs.map((belief) => ({
      id: belief.id,
      statement: belief.statement,
      type: belief.type,
      confidence: belief.confidence,
      updatedAt: belief.updated_at,
      accessCount: belief.access_count,
      isNew: Date.now() - new Date(belief.updated_at).getTime() < 24 * 60 * 60 * 1000,
      subject: belief.subject,
    })),
    recentActivity: recentEpisodes.map((episode) => episode.content.slice(0, 100)),
    stats: {
      totalBeliefs: stats.beliefs.active,
      avgConfidence: stats.avgConfidence,
      episodes: stats.episodes,
    },
    knowledgeSources: sources.map((source) => ({ title: source.title ?? source.url, url: source.url })),
  };

  const fallbackSections = buildFallbackBriefing(rawContext);

  const prompt = `You are a personal AI assistant generating a daily briefing for ${ownerName}.
Today is ${rawContext.date}, ${rawContext.time}.

Generate a FRESH, decision-ready briefing based on the following context. The output must stay recommendation-first, highlight what changed, and make correction easy.

OPEN TASKS (${tasks.length}):
${JSON.stringify(rawContext.tasks, null, 2)}

RECENTLY COMPLETED (${recentlyDone.length}):
${JSON.stringify(rawContext.recentlyCompleted, null, 2)}

ACTIVE GOALS (${goals.length}):
${JSON.stringify(rawContext.goals, null, 2)}

ACTIVE PROGRAMS (${programs.length}):
${JSON.stringify(rawContext.programs, null, 2)}

LINKED ACTION SIGNALS (${rawContext.actionSignals.length}):
${JSON.stringify(rawContext.actionSignals, null, 2)}

MEMORY — RECENT & TOP BELIEFS (${topBeliefs.length} shown, ${stats.beliefs.active} total active):
${JSON.stringify(rawContext.beliefs, null, 2)}

RECENT ACTIVITY (last conversations/interactions):
${rawContext.recentActivity.length > 0 ? rawContext.recentActivity.join("\n") : "(no recent activity)"}

KNOWLEDGE SOURCES (${sources.length}):
${JSON.stringify(rawContext.knowledgeSources, null, 2)}

${previousBriefingSummary ? `PREVIOUS BRIEFINGS (you MUST NOT repeat these — choose DIFFERENT angles):\n${previousBriefingSummary}\n` : ""}
Guidelines:
- Recommendation comes first. The briefing should tell the user what to do, hold, or watch next.
- Use active Programs as the primary object when they exist. Avoid talking about raw schedules, jobs, or internal mechanics.
- Linked actions are existing follow-through attached to Programs or previous Briefs. Treat them as product context, not as anonymous tasks.
- If a linked action is already complete, use that completion as a change signal and do not repeat it as a next action.
- If a linked action is still open or stale, make that explicit in the recommendation, evidence, or next actions instead of inventing duplicate follow-through.
- what_changed should be concise and specific. Prefer 2-4 bullets.
- evidence should cite either an external source or an observed product artifact (Program definition, memory belief, recent activity, task state).
- memory_assumptions should name the assumptions that materially influenced the recommendation and explain where they came from.
- next_actions should be specific and concrete. Keep them short.
- correction_hook should invite the user to correct assumptions or priorities for the next brief.
- Keep everything concise. Each field should be useful without exposing backend internals.

Respond ONLY with a valid JSON object matching this exact shape (no markdown, no explanation):
{
  "title": "string (optional)",
  "recommendation": { "summary": "string", "confidence": "low|medium|high", "rationale": "string" },
  "what_changed": ["string"],
  "evidence": [{ "title": "string", "detail": "string", "sourceLabel": "string", "sourceUrl": "string (optional)", "freshness": "string (optional)" }],
  "memory_assumptions": [{ "statement": "string", "confidence": "low|medium|high", "provenance": "string" }],
  "next_actions": [{ "title": "string", "timing": "string", "detail": "string", "owner": "string (optional)" }],
  "correction_hook": { "prompt": "string" }
}`;

  const id = briefingId ?? crypto.randomUUID();
  const hasExisting = briefingId
    ? ctx.storage.query<{ id: string }>("SELECT id FROM briefings WHERE id = ?", [briefingId]).length > 0
    : false;
  if (hasExisting) {
    ctx.storage.run(
      `UPDATE briefings
       SET status = 'generating',
           raw_context = ?,
           started_at = ?,
           last_attempt_at = ?,
           attempt_count = attempt_count + 1
       WHERE id = ?`,
      [JSON.stringify(rawContext), new Date().toISOString(), new Date().toISOString(), id],
    );
  } else {
    ctx.storage.run(
      "INSERT INTO briefings (id, generated_at, sections, raw_context, status, type, queued_at, started_at, last_attempt_at, attempt_count, source_kind) VALUES (?, datetime('now'), '{}', ?, 'generating', 'daily', ?, ?, ?, 1, 'maintenance')",
      [id, JSON.stringify(rawContext), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()],
    );
  }

  let parsed = fallbackSections;
  if (llmHealthy) {
    try {
      const budget = getContextBudget(ctx.config.llm.provider, ctx.config.llm.model, ctx.config.llm.contextWindow);
      const { result } = await instrumentedGenerateText(
        { storage: ctx.storage, logger: ctx.logger },
        {
          model: ctx.llm.getModel() as LanguageModel,
          prompt,
          temperature: 0.5,
          maxRetries: 1,
          timeout: BRIEFING_LLM_TIMEOUT,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          providerOptions: getProviderOptions(ctx.config.llm.provider, budget.contextWindow) as any,
        },
        {
          spanType: "llm",
          process: "briefing.generate",
          traceId: telemetry?.traceId,
          runId: telemetry?.runId,
          surface: "worker",
          provider: ctx.config.llm.provider,
          model: ctx.config.llm.model,
          requestSizeChars: prompt.length,
        },
      );

      let jsonText = result.text.trim();
      const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch?.[1]) jsonText = fenceMatch[1].trim();
      parsed = mergeActionLeadIntoBriefing(
        normalizeBriefingSections(JSON.parse(jsonText), fallbackSections),
        buildActionLead(rawContext, selectPrimaryProgram(rawContext.programs, rawContext.actionSignals)),
      );
    } catch (error) {
      ctx.logger.warn("Briefing generation fell back to deterministic brief", {
        error: error instanceof Error ? error.message : String(error),
      });
      parsed = fallbackSections;
    }
  } else {
    ctx.logger.info("Briefing generation used deterministic fallback", {
      reason: "llm-unhealthy",
    });
  }

  try {
    ctx.storage.run(
      "UPDATE briefings SET sections = ?, status = 'ready' WHERE id = ?",
      [JSON.stringify(parsed), id],
    );
    pruneOldBriefings(ctx.storage);
    return {
      id,
      generatedAt: new Date().toISOString(),
      sections: parsed,
      status: "ready",
      type: "daily",
      queuedAt: null,
      startedAt: new Date().toISOString(),
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
      sourceKind: "maintenance",
    };
  } catch (error) {
    console.error("Briefing generation failed:", error instanceof Error ? error.message : String(error));
    ctx.logger.error("Briefing generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.storage.run(
      "UPDATE briefings SET status = 'failed' WHERE id = ?",
      [id],
    );
    return null;
  }
}
