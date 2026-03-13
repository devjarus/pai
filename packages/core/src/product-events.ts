import { nanoid } from "nanoid";

import type { Migration, Storage } from "./types.js";

export type ProductEventType =
  | "program_created"
  | "brief_opened"
  | "brief_followup_asked"
  | "brief_action_created"
  | "brief_action_completed"
  | "belief_corrected"
  | "recommendation_accepted"
  | "telegram_brief_interaction";

export interface ProductEvent {
  id: string;
  event_type: ProductEventType;
  occurred_at: string;
  channel: string;
  program_id: string | null;
  brief_id: string | null;
  belief_id: string | null;
  action_id: string | null;
  thread_id: string | null;
  metadata_json: string | null;
}

export interface ProductMetricsOverview {
  rangeDays: number;
  generatedBriefs: number;
  openedBriefs: number;
  briefOpenRate: number;
  trustedDecisionLoops: number;
  trustedDecisionLoopRate: number;
  briefActionCreatedCount: number;
  briefActionCompletedCount: number;
  actionConversionRate: number;
  followUpQuestionsCount: number;
  followUpRate: number;
  beliefCorrectionsCount: number;
  recommendationAcceptedCount: number;
  telegramInteractionCount: number;
  medianCorrectionLatencyMinutes: number | null;
}

export const productEventMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS product_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
        channel TEXT NOT NULL DEFAULT 'web',
        program_id TEXT,
        brief_id TEXT,
        belief_id TEXT,
        action_id TEXT,
        thread_id TEXT,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_product_events_type_time ON product_events(event_type, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_product_events_brief ON product_events(brief_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_product_events_program ON product_events(program_id, occurred_at);
    `,
  },
];

export function recordProductEvent(
  storage: Storage,
  input: {
    eventType: ProductEventType;
    channel?: string;
    occurredAt?: string;
    programId?: string | null;
    briefId?: string | null;
    beliefId?: string | null;
    actionId?: string | null;
    threadId?: string | null;
    metadata?: Record<string, unknown>;
  },
): ProductEvent {
  const event: ProductEvent = {
    id: nanoid(),
    event_type: input.eventType,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    channel: input.channel ?? "web",
    program_id: input.programId ?? null,
    brief_id: input.briefId ?? null,
    belief_id: input.beliefId ?? null,
    action_id: input.actionId ?? null,
    thread_id: input.threadId ?? null,
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
  };

  storage.run(
    `INSERT INTO product_events (
      id, event_type, occurred_at, channel, program_id, brief_id, belief_id, action_id, thread_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.event_type,
      event.occurred_at,
      event.channel,
      event.program_id,
      event.brief_id,
      event.belief_id,
      event.action_id,
      event.thread_id,
      event.metadata_json,
    ],
  );

  return event;
}

export function listProductEvents(storage: Storage, options?: { since?: string; types?: ProductEventType[] }): ProductEvent[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options?.since) {
    where.push("occurred_at >= ?");
    params.push(options.since);
  }
  if (options?.types && options.types.length > 0) {
    where.push(`event_type IN (${options.types.map(() => "?").join(", ")})`);
    params.push(...options.types);
  }

  const query = `SELECT * FROM product_events${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY occurred_at DESC`;
  return storage.query<ProductEvent>(query, params);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

export function getProductMetricsOverview(storage: Storage, rangeDays = 30): ProductMetricsOverview {
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  const generatedBriefs = storage.query<{ count: number }>(
    "SELECT COUNT(*) as count FROM briefings WHERE status = 'ready' AND generated_at >= ?",
    [since],
  )[0]?.count ?? 0;
  const events = listProductEvents(storage, { since });
  const briefOpenEvents = events.filter((event) => event.event_type === "brief_opened" && event.brief_id);
  const openedBriefIds = new Set(briefOpenEvents.map((event) => event.brief_id!));

  const qualifyingTypes = new Set<ProductEventType>([
    "recommendation_accepted",
    "brief_action_created",
    "brief_action_completed",
    "belief_corrected",
    "brief_followup_asked",
    "telegram_brief_interaction",
  ]);

  const trustedLoopBriefIds = new Set<string>();
  const correctionLatencies: number[] = [];

  for (const openEvent of briefOpenEvents) {
    const openAt = Date.parse(openEvent.occurred_at);
    if (!Number.isFinite(openAt)) continue;
    const closeWindow = openAt + 72 * 60 * 60 * 1000;
    const related = events.filter((event) =>
      event.brief_id === openEvent.brief_id
      && qualifyingTypes.has(event.event_type)
      && Date.parse(event.occurred_at) >= openAt
      && Date.parse(event.occurred_at) <= closeWindow,
    );
    if (related.length > 0) {
      trustedLoopBriefIds.add(openEvent.brief_id!);
    }
    const correctionEvent = related.find((event) => event.event_type === "belief_corrected");
    if (correctionEvent) {
      const diffMinutes = (Date.parse(correctionEvent.occurred_at) - openAt) / 60_000;
      if (Number.isFinite(diffMinutes) && diffMinutes >= 0) {
        correctionLatencies.push(diffMinutes);
      }
    }
  }

  const briefActionCreatedCount = events.filter((event) => event.event_type === "brief_action_created").length;
  const briefActionCompletedCount = events.filter((event) => event.event_type === "brief_action_completed").length;
  const followUpQuestionsCount = events.filter((event) => event.event_type === "brief_followup_asked").length;
  const beliefCorrectionsCount = events.filter((event) => event.event_type === "belief_corrected").length;
  const recommendationAcceptedCount = events.filter((event) => event.event_type === "recommendation_accepted").length;
  const telegramInteractionCount = events.filter((event) => event.event_type === "telegram_brief_interaction").length;

  const openedBriefs = openedBriefIds.size;
  const trustedDecisionLoops = trustedLoopBriefIds.size;

  return {
    rangeDays,
    generatedBriefs,
    openedBriefs,
    briefOpenRate: generatedBriefs > 0 ? openedBriefs / generatedBriefs : 0,
    trustedDecisionLoops,
    trustedDecisionLoopRate: generatedBriefs > 0 ? trustedDecisionLoops / generatedBriefs : 0,
    briefActionCreatedCount,
    briefActionCompletedCount,
    actionConversionRate: generatedBriefs > 0 ? briefActionCreatedCount / generatedBriefs : 0,
    followUpQuestionsCount,
    followUpRate: generatedBriefs > 0 ? followUpQuestionsCount / generatedBriefs : 0,
    beliefCorrectionsCount,
    recommendationAcceptedCount,
    telegramInteractionCount,
    medianCorrectionLatencyMinutes: median(correctionLatencies),
  };
}
