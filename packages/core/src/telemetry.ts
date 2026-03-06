import { randomUUID } from "node:crypto";
import { generateText, streamText } from "ai";
import type { Logger, Migration, Storage, TelemetryAttributes, TelemetrySpanType, TelemetryStatus } from "./types.js";

export const TELEMETRY_RETENTION_DAYS = 30;

export const telemetryMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS telemetry_spans (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_span_id TEXT,
        span_type TEXT NOT NULL,
        surface TEXT,
        process TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        thread_id TEXT,
        job_id TEXT,
        run_id TEXT,
        agent_name TEXT,
        tool_name TEXT,
        route TEXT,
        chat_id TEXT,
        sender_username TEXT,
        sender_display_name TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        step_count INTEGER,
        duration_ms INTEGER,
        request_size_chars INTEGER,
        response_size_chars INTEGER,
        error_code TEXT,
        error_message TEXT,
        metadata_json TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_spans_started_at ON telemetry_spans(started_at);
      CREATE INDEX IF NOT EXISTS idx_telemetry_spans_trace_id ON telemetry_spans(trace_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_spans_process ON telemetry_spans(process);
      CREATE INDEX IF NOT EXISTS idx_telemetry_spans_thread_id ON telemetry_spans(thread_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_spans_job_id ON telemetry_spans(job_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_spans_status ON telemetry_spans(status);
    `,
  },
];

export type ObservabilityRange = "24h" | "7d" | "30d";

export interface TelemetryRuntime {
  storage?: Storage;
  logger?: Logger;
}

export interface TelemetryStartInput extends TelemetryAttributes {
  spanType: TelemetrySpanType;
  status?: TelemetryStatus;
}

export interface ActiveTelemetrySpan {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  spanType: TelemetrySpanType;
  surface: string | null;
  process: string;
  status: TelemetryStatus;
  provider: string | null;
  model: string | null;
  threadId: string | null;
  jobId: string | null;
  runId: string | null;
  agentName: string | null;
  toolName: string | null;
  route: string | null;
  chatId: string | null;
  senderUsername: string | null;
  senderDisplayName: string | null;
  requestSizeChars: number | null;
  responseSizeChars: number | null;
  metadataJson: string | null;
  startedAt: string;
}

export interface TelemetrySpanRow {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  span_type: string;
  surface: string | null;
  process: string;
  status: string;
  provider: string | null;
  model: string | null;
  thread_id: string | null;
  job_id: string | null;
  run_id: string | null;
  agent_name: string | null;
  tool_name: string | null;
  route: string | null;
  chat_id: string | null;
  sender_username: string | null;
  sender_display_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  step_count: number | null;
  duration_ms: number | null;
  request_size_chars: number | null;
  response_size_chars: number | null;
  error_code: string | null;
  error_message: string | null;
  metadata_json: string | null;
  started_at: string;
  ended_at: string;
}

export interface TelemetrySpan {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  spanType: string;
  surface: string | null;
  process: string;
  status: string;
  provider: string | null;
  model: string | null;
  threadId: string | null;
  jobId: string | null;
  runId: string | null;
  agentName: string | null;
  toolName: string | null;
  route: string | null;
  chatId: string | null;
  senderUsername: string | null;
  senderDisplayName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  stepCount: number | null;
  durationMs: number | null;
  requestSizeChars: number | null;
  responseSizeChars: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string;
}

export interface TelemetrySummary {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface ProcessAggregate extends TelemetrySummary {
  process: string;
  avgStepCount: number;
}

export interface ModelAggregate extends TelemetrySummary {
  provider: string | null;
  model: string | null;
}

export interface ObservabilityOverview {
  range: ObservabilityRange;
  since: string;
  totals: TelemetrySummary;
  topProcesses: ProcessAggregate[];
  topModels: ModelAggregate[];
}

export interface ThreadMessageUsage {
  traceId: string;
  process: string;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  stepCount?: number | null;
  toolCallCount?: number | null;
}

export interface ThreadDiagnosticsMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  sequence: number;
  usage: ThreadMessageUsage | null;
}

export interface ThreadDiagnostics {
  threadId: string;
  totals: TelemetrySummary;
  processBreakdown: ProcessAggregate[];
  messages: ThreadDiagnosticsMessage[];
}

export interface AgentAggregate extends TelemetrySummary {
  agentName: string;
}

export interface JobDiagnostics {
  jobId: string;
  totals: TelemetrySummary;
  processBreakdown: ProcessAggregate[];
  agentBreakdown: AgentAggregate[];
  recentSpans: TelemetrySpan[];
}

export interface RecentError {
  id: string;
  traceId: string;
  process: string;
  surface: string | null;
  route: string | null;
  threadId: string | null;
  jobId: string | null;
  model: string | null;
  provider: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string;
}

function safeStringify(data: Record<string, unknown> | undefined): string | null {
  if (!data || Object.keys(data).length === 0) return null;
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

function parseMetadata(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function toNullableString(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function rangeSince(range: ObservabilityRange): string {
  const now = Date.now();
  const ms = range === "30d"
    ? 30 * 24 * 60 * 60 * 1000
    : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

function selectSpans(storage: Storage, params: { since?: string; traceId?: string; threadId?: string; jobId?: string; limit?: number; status?: string }): TelemetrySpanRow[] {
  const where: string[] = [];
  const values: unknown[] = [];
  if (params.since) {
    where.push("started_at >= ?");
    values.push(params.since);
  }
  if (params.traceId) {
    where.push("trace_id = ?");
    values.push(params.traceId);
  }
  if (params.threadId) {
    where.push("thread_id = ?");
    values.push(params.threadId);
  }
  if (params.jobId) {
    where.push("job_id = ?");
    values.push(params.jobId);
  }
  if (params.status) {
    where.push("status = ?");
    values.push(params.status);
  }
  const sql = [
    "SELECT * FROM telemetry_spans",
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    "ORDER BY started_at DESC",
    params.limit ? "LIMIT ?" : "",
  ].filter(Boolean).join(" ");
  if (params.limit) values.push(params.limit);
  return storage.query<TelemetrySpanRow>(sql, values);
}

function mapRow(row: TelemetrySpanRow): TelemetrySpan {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id,
    spanType: row.span_type,
    surface: row.surface,
    process: row.process,
    status: row.status,
    provider: row.provider,
    model: row.model,
    threadId: row.thread_id,
    jobId: row.job_id,
    runId: row.run_id,
    agentName: row.agent_name,
    toolName: row.tool_name,
    route: row.route,
    chatId: row.chat_id,
    senderUsername: row.sender_username,
    senderDisplayName: row.sender_display_name,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    stepCount: row.step_count,
    durationMs: row.duration_ms,
    requestSizeChars: row.request_size_chars,
    responseSizeChars: row.response_size_chars,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    metadata: parseMetadata(row.metadata_json),
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function summarizeRows(rows: TelemetrySpanRow[]): TelemetrySummary {
  const durations = rows.map((row) => row.duration_ms ?? 0).filter((value) => value > 0);
  return {
    calls: rows.length,
    errors: rows.filter((row) => row.status === "error").length,
    inputTokens: rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
    totalTokens: rows.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
    avgDurationMs: average(durations),
    p95DurationMs: percentile95(durations),
  };
}

function summarizeAggregateRows(rows: TelemetrySpanRow[]): TelemetrySpanRow[] {
  return rows.filter((row) => row.span_type !== "tool");
}

export function createChildTelemetry(
  parent: Pick<ActiveTelemetrySpan, "id" | "traceId" | "surface" | "process" | "threadId" | "jobId" | "runId" | "agentName" | "route" | "chatId" | "senderUsername" | "senderDisplayName">,
  overrides: Partial<TelemetryAttributes>,
): TelemetryAttributes {
  return {
    traceId: parent.traceId,
    parentSpanId: parent.id,
    surface: (overrides.surface ?? parent.surface ?? undefined) as TelemetryAttributes["surface"],
    threadId: overrides.threadId ?? parent.threadId ?? undefined,
    jobId: overrides.jobId ?? parent.jobId ?? undefined,
    runId: overrides.runId ?? parent.runId ?? undefined,
    agentName: overrides.agentName ?? parent.agentName ?? undefined,
    route: overrides.route ?? parent.route ?? undefined,
    chatId: overrides.chatId ?? parent.chatId ?? undefined,
    senderUsername: overrides.senderUsername ?? parent.senderUsername ?? undefined,
    senderDisplayName: overrides.senderDisplayName ?? parent.senderDisplayName ?? undefined,
    process: overrides.process ?? parent.process,
    toolName: overrides.toolName,
    metadata: {
      ...(parent.route ? { route: parent.route } : {}),
      ...(overrides.metadata ?? {}),
    },
  };
}

function getTotalTokens(usage: { inputTokens?: number | null; outputTokens?: number | null } | undefined): number | null {
  if (!usage) return null;
  if (usage.inputTokens == null && usage.outputTokens == null) return null;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

function jsonLength(value: unknown): number | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
}

function closeToolSpans(
  runtime: TelemetryRuntime,
  toolSpans: Map<string, ActiveTelemetrySpan>,
  status: TelemetryStatus,
  errorMessage?: string | null,
): void {
  for (const activeToolSpan of toolSpans.values()) {
    finishSpan(runtime, activeToolSpan, {
      status,
      errorMessage: errorMessage ?? null,
    });
  }
  toolSpans.clear();
}

export function startSpan(_runtime: TelemetryRuntime, input: TelemetryStartInput): ActiveTelemetrySpan {
  const startedAt = new Date().toISOString();
  const spanId = randomUUID();
  return {
    id: spanId,
    traceId: input.traceId ?? randomUUID(),
    parentSpanId: input.parentSpanId ?? null,
    spanType: input.spanType,
    surface: input.surface ?? null,
    process: input.process,
    status: input.status ?? "ok",
    provider: input.provider ?? null,
    model: input.model ?? null,
    threadId: input.threadId ?? null,
    jobId: input.jobId ?? null,
    runId: input.runId ?? null,
    agentName: input.agentName ?? null,
    toolName: input.toolName ?? null,
    route: input.route ?? null,
    chatId: toNullableString(input.chatId),
    senderUsername: input.senderUsername ?? null,
    senderDisplayName: input.senderDisplayName ?? null,
    requestSizeChars: input.requestSizeChars ?? null,
    responseSizeChars: null,
    metadataJson: safeStringify(input.metadata),
    startedAt,
  };
}

export function finishSpan(runtime: TelemetryRuntime, active: ActiveTelemetrySpan, updates: {
  status?: TelemetryStatus;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  stepCount?: number | null;
  responseSizeChars?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
} = {}): TelemetrySpan | null {
  const endedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(active.startedAt));
  const metadata = updates.metadata
    ? {
        ...(parseMetadata(active.metadataJson) ?? {}),
        ...updates.metadata,
      }
    : parseMetadata(active.metadataJson);
  const span: TelemetrySpan = {
    id: active.id,
    traceId: active.traceId,
    parentSpanId: active.parentSpanId,
    spanType: active.spanType,
    surface: active.surface,
    process: active.process,
    status: updates.status ?? active.status,
    provider: active.provider,
    model: active.model,
    threadId: active.threadId,
    jobId: active.jobId,
    runId: active.runId,
    agentName: active.agentName,
    toolName: active.toolName,
    route: active.route,
    chatId: active.chatId,
    senderUsername: active.senderUsername,
    senderDisplayName: active.senderDisplayName,
    inputTokens: updates.inputTokens ?? null,
    outputTokens: updates.outputTokens ?? null,
    totalTokens: updates.totalTokens ?? null,
    stepCount: updates.stepCount ?? null,
    durationMs,
    requestSizeChars: active.requestSizeChars,
    responseSizeChars: updates.responseSizeChars ?? active.responseSizeChars,
    errorCode: updates.errorCode ?? null,
    errorMessage: updates.errorMessage ?? null,
    metadata,
    startedAt: active.startedAt,
    endedAt,
  };

  if (!runtime.storage) return span;

  try {
    runtime.storage.run(
      `INSERT INTO telemetry_spans (
        id, trace_id, parent_span_id, span_type, surface, process, status, provider, model,
        thread_id, job_id, run_id, agent_name, tool_name, route, chat_id, sender_username,
        sender_display_name, input_tokens, output_tokens, total_tokens, step_count, duration_ms,
        request_size_chars, response_size_chars, error_code, error_message, metadata_json,
        started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        span.id,
        span.traceId,
        span.parentSpanId,
        span.spanType,
        span.surface,
        span.process,
        span.status,
        span.provider,
        span.model,
        span.threadId,
        span.jobId,
        span.runId,
        span.agentName,
        span.toolName,
        span.route,
        span.chatId,
        span.senderUsername,
        span.senderDisplayName,
        span.inputTokens,
        span.outputTokens,
        span.totalTokens,
        span.stepCount,
        span.durationMs,
        span.requestSizeChars,
        span.responseSizeChars,
        span.errorCode,
        span.errorMessage,
        safeStringify(span.metadata ?? undefined),
        span.startedAt,
        span.endedAt,
      ],
    );
    runtime.logger?.debug("Telemetry span", {
      traceId: span.traceId,
      spanId: span.id,
      process: span.process,
      threadId: span.threadId ?? undefined,
      jobId: span.jobId ?? undefined,
      durationMs: span.durationMs ?? undefined,
      totalTokens: span.totalTokens ?? undefined,
      status: span.status,
    });
  } catch (err) {
    runtime.logger?.warn("Telemetry span persistence failed", {
      process: span.process,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return span;
}

export function cleanupOldTelemetrySpans(storage: Storage, olderThanDays = TELEMETRY_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM telemetry_spans WHERE started_at < ?",
    [cutoff],
  )[0]?.cnt ?? 0;
  storage.run("DELETE FROM telemetry_spans WHERE started_at < ?", [cutoff]);
  return count;
}

export function getObservabilityOverview(storage: Storage, range: ObservabilityRange = "24h"): ObservabilityOverview {
  const since = rangeSince(range);
  const rows = summarizeAggregateRows(selectSpans(storage, { since }));
  const totals = summarizeRows(rows);
  const topProcesses = listProcessAggregates(storage, range).slice(0, 5);
  const modelMap = new Map<string, TelemetrySpanRow[]>();
  for (const row of rows) {
    if (!row.provider && !row.model) continue;
    const key = `${row.provider ?? ""}::${row.model ?? ""}`;
    const list = modelMap.get(key) ?? [];
    list.push(row);
    modelMap.set(key, list);
  }
  const topModels = [...modelMap.entries()]
    .map(([key, grouped]) => {
      const [provider, model] = key.split("::");
      return {
        provider: provider || null,
        model: model || null,
        ...summarizeRows(grouped),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls)
    .slice(0, 5);
  return { range, since, totals, topProcesses, topModels };
}

export function listProcessAggregates(storage: Storage, range: ObservabilityRange = "24h"): ProcessAggregate[] {
  const rows = summarizeAggregateRows(selectSpans(storage, { since: rangeSince(range) }));
  const groups = new Map<string, TelemetrySpanRow[]>();
  for (const row of rows) {
    const list = groups.get(row.process) ?? [];
    list.push(row);
    groups.set(row.process, list);
  }
  return [...groups.entries()]
    .map(([process, grouped]) => ({
      process,
      ...summarizeRows(grouped),
      avgStepCount: average(grouped.map((row) => row.step_count ?? 0).filter((value) => value > 0)),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

export function getTraceSpans(storage: Storage, traceId: string): TelemetrySpan[] {
  return selectSpans(storage, { traceId })
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    .map(mapRow);
}

export function listRecentErrors(storage: Storage, range: ObservabilityRange = "24h", limit = 50): RecentError[] {
  return selectSpans(storage, { since: rangeSince(range), status: "error", limit }).map((row) => ({
    id: row.id,
    traceId: row.trace_id,
    process: row.process,
    surface: row.surface,
    route: row.route,
    threadId: row.thread_id,
    jobId: row.job_id,
    model: row.model,
    provider: row.provider,
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    startedAt: row.started_at,
  }));
}

export function getThreadDiagnostics(storage: Storage, threadId: string, limit = 50): ThreadDiagnostics {
  const rows = summarizeAggregateRows(selectSpans(storage, { threadId }));
  const messages = storage.query<{
    id: string;
    role: string;
    content: string;
    created_at: string;
    sequence: number;
    usage_json: string | null;
  }>(
    "SELECT id, role, content, created_at, sequence, usage_json FROM thread_messages WHERE thread_id = ? ORDER BY sequence DESC LIMIT ?",
    [threadId, limit],
  ).reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    sequence: row.sequence,
    usage: row.usage_json ? JSON.parse(row.usage_json) as ThreadMessageUsage : null,
  }));
  return {
    threadId,
    totals: summarizeRows(rows),
    processBreakdown: listGroupedBreakdown(rows),
    messages,
  };
}

function listGroupedBreakdown(rows: TelemetrySpanRow[]): ProcessAggregate[] {
  const groups = new Map<string, TelemetrySpanRow[]>();
  for (const row of rows) {
    const list = groups.get(row.process) ?? [];
    list.push(row);
    groups.set(row.process, list);
  }
  return [...groups.entries()]
    .map(([process, grouped]) => ({
      process,
      ...summarizeRows(grouped),
      avgStepCount: average(grouped.map((row) => row.step_count ?? 0).filter((value) => value > 0)),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

export function getJobDiagnostics(storage: Storage, jobId: string): JobDiagnostics {
  const rows = summarizeAggregateRows(selectSpans(storage, { jobId }));
  const allRows = selectSpans(storage, { jobId });
  const agentGroups = new Map<string, TelemetrySpanRow[]>();
  for (const row of rows) {
    if (!row.agent_name) continue;
    const list = agentGroups.get(row.agent_name) ?? [];
    list.push(row);
    agentGroups.set(row.agent_name, list);
  }
  const agentBreakdown = [...agentGroups.entries()]
    .map(([agentName, grouped]) => ({
      agentName,
      ...summarizeRows(grouped),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
  return {
    jobId,
    totals: summarizeRows(rows),
    processBreakdown: listGroupedBreakdown(rows),
    agentBreakdown,
    recentSpans: allRows.slice(0, 50).map(mapRow),
  };
}

export async function instrumentedGenerateText(
  runtime: TelemetryRuntime,
  options: Parameters<typeof generateText>[0],
  telemetry: TelemetryStartInput,
): Promise<{ result: Awaited<ReturnType<typeof generateText>>; traceId: string; spanId: string }> {
  const span = startSpan(runtime, telemetry);
  const toolSpans = new Map<string, ActiveTelemetrySpan>();
  let stepCount = 0;
  const originalOnStepFinish = (options as { onStepFinish?: ((event: unknown) => void) | undefined }).onStepFinish;
  const wrappedOptions = {
    ...options,
    onStepFinish: (event: unknown) => {
      stepCount += 1;
      originalOnStepFinish?.(event);
    },
    experimental_onToolCallStart: (event: Record<string, unknown>) => {
      const toolCall = event.toolCall as Record<string, unknown> | undefined;
      const toolCallId = typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : randomUUID();
      const toolName = typeof toolCall?.toolName === "string" ? toolCall.toolName : "tool";
      toolSpans.set(toolCallId, startSpan(runtime, {
        ...createChildTelemetry(span, { process: telemetry.process, toolName }),
        spanType: "tool",
        toolName,
        metadata: { args: event.input ?? null },
      }));
      const callback = (options as Record<string, unknown>).experimental_onToolCallStart as ((evt: unknown) => void) | undefined;
      callback?.(event);
    },
    experimental_onToolCallFinish: (event: Record<string, unknown>) => {
      const toolCall = event.toolCall as Record<string, unknown> | undefined;
      const toolCallId = typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : "";
      const activeToolSpan = toolSpans.get(toolCallId);
      if (activeToolSpan) {
        finishSpan(runtime, activeToolSpan, {
          status: event.success === false || event.error ? "error" : "ok",
          responseSizeChars: typeof event.output === "string" ? event.output.length : jsonLength(event.output),
          errorMessage: event.error ? String(event.error) : null,
          metadata: {
            durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
          },
        });
        toolSpans.delete(toolCallId);
      }
      const callback = (options as Record<string, unknown>).experimental_onToolCallFinish as ((evt: unknown) => void) | undefined;
      callback?.(event);
    },
  };

  try {
    const result = await generateText(wrappedOptions);
    closeToolSpans(runtime, toolSpans, "ok");
    finishSpan(runtime, span, {
      status: "ok",
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: getTotalTokens(result.usage),
      stepCount: stepCount || result.steps?.length || null,
      responseSizeChars: result.text?.length ?? null,
    });
    return { result, traceId: span.traceId, spanId: span.id };
  } catch (err) {
    closeToolSpans(runtime, toolSpans, "error", err instanceof Error ? err.message : String(err));
    finishSpan(runtime, span, {
      status: "error",
      stepCount: stepCount || null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function instrumentedStreamText(
  runtime: TelemetryRuntime,
  options: Parameters<typeof streamText>[0],
  telemetry: TelemetryStartInput,
): { result: ReturnType<typeof streamText>; traceId: string; spanId: string } {
  const span = startSpan(runtime, telemetry);
  const toolSpans = new Map<string, ActiveTelemetrySpan>();
  let finished = false;
  let stepCount = 0;

  const finishRoot = (updates: NonNullable<Parameters<typeof finishSpan>[2]>) => {
    if (finished) return;
    finished = true;
    closeToolSpans(runtime, toolSpans, updates.status === "ok" ? "ok" : "error", updates.errorMessage ?? null);
    finishSpan(runtime, span, updates);
  };

  const wrappedOptions = {
    ...options,
    onStepFinish: (event: unknown) => {
      stepCount += 1;
      const callback = (options as { onStepFinish?: ((evt: unknown) => void) | undefined }).onStepFinish;
      callback?.(event);
    },
    onFinish: (event: Record<string, unknown>) => {
      const usage = (event.totalUsage ?? event.usage) as { inputTokens?: number; outputTokens?: number } | undefined;
      const text = typeof event.text === "string" ? event.text : "";
      finishRoot({
        status: "ok",
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: getTotalTokens(usage),
        stepCount: stepCount || (Array.isArray(event.steps) ? event.steps.length : null),
        responseSizeChars: text.length,
      });
      const callback = (options as { onFinish?: ((evt: unknown) => void) | undefined }).onFinish;
      callback?.(event);
    },
    onError: (event: Record<string, unknown>) => {
      finishRoot({
        status: "error",
        stepCount: stepCount || null,
        errorMessage: event.error instanceof Error ? event.error.message : String(event.error),
      });
      const callback = (options as { onError?: ((evt: unknown) => void) | undefined }).onError;
      callback?.(event);
    },
    experimental_onToolCallStart: (event: Record<string, unknown>) => {
      const toolCall = event.toolCall as Record<string, unknown> | undefined;
      const toolCallId = typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : randomUUID();
      const toolName = typeof toolCall?.toolName === "string" ? toolCall.toolName : "tool";
      toolSpans.set(toolCallId, startSpan(runtime, {
        ...createChildTelemetry(span, { process: telemetry.process, toolName }),
        spanType: "tool",
        toolName,
        metadata: { args: event.input ?? null },
      }));
      const callback = (options as Record<string, unknown>).experimental_onToolCallStart as ((evt: unknown) => void) | undefined;
      callback?.(event);
    },
    experimental_onToolCallFinish: (event: Record<string, unknown>) => {
      const toolCall = event.toolCall as Record<string, unknown> | undefined;
      const toolCallId = typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : "";
      const activeToolSpan = toolSpans.get(toolCallId);
      if (activeToolSpan) {
        finishSpan(runtime, activeToolSpan, {
          status: event.success === false || event.error ? "error" : "ok",
          responseSizeChars: typeof event.output === "string" ? event.output.length : jsonLength(event.output),
          errorMessage: event.error ? String(event.error) : null,
          metadata: { durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined },
        });
        toolSpans.delete(toolCallId);
      }
      const callback = (options as Record<string, unknown>).experimental_onToolCallFinish as ((evt: unknown) => void) | undefined;
      callback?.(event);
    },
  } as unknown as Parameters<typeof streamText>[0];

  const result = streamText(wrappedOptions);

  return { result, traceId: span.traceId, spanId: span.id };
}

export async function instrumentedEmbed<T>(
  runtime: TelemetryRuntime,
  telemetry: TelemetryStartInput,
  execute: () => Promise<{ result: T; responseSizeChars?: number | null; inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null; metadata?: Record<string, unknown> }>,
): Promise<{ result: T; traceId: string; spanId: string }> {
  const span = startSpan(runtime, telemetry);

  try {
    const output = await execute();
    finishSpan(runtime, span, {
      status: "ok",
      inputTokens: output.inputTokens ?? null,
      outputTokens: output.outputTokens ?? null,
      totalTokens: output.totalTokens ?? null,
      responseSizeChars: output.responseSizeChars ?? null,
      metadata: output.metadata,
    });
    return { result: output.result, traceId: span.traceId, spanId: span.id };
  } catch (err) {
    finishSpan(runtime, span, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
