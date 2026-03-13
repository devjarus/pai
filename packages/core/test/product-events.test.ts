import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createStorage } from "../src/storage.js";
import type { Storage } from "../src/types.js";
import {
  getProductMetricsOverview,
  listProductEvents,
  productEventMigrations,
  recordProductEvent,
} from "../src/product-events.js";

describe("product-events", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-product-events-"));
    storage = createStorage(dir);
    storage.migrate("product_events", productEventMigrations);
    storage.run(`
      CREATE TABLE briefings (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        generated_at TEXT NOT NULL
      )
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records and lists product events with filters", () => {
    const created = recordProductEvent(storage, {
      eventType: "program_created",
      channel: "web",
      occurredAt: "2026-03-10T10:00:00.000Z",
      programId: "prog-1",
      threadId: "thread-1",
      metadata: { family: "travel" },
    });
    recordProductEvent(storage, {
      eventType: "brief_opened",
      channel: "telegram",
      occurredAt: "2026-03-11T10:00:00.000Z",
      briefId: "brief-1",
    });

    expect(created.id).toBeTruthy();
    expect(created.metadata_json).toBe(JSON.stringify({ family: "travel" }));

    expect(listProductEvents(storage)).toEqual([
      expect.objectContaining({
        event_type: "brief_opened",
        channel: "telegram",
        brief_id: "brief-1",
      }),
      expect.objectContaining({
        event_type: "program_created",
        channel: "web",
        program_id: "prog-1",
        thread_id: "thread-1",
      }),
    ]);

    expect(listProductEvents(storage, { since: "2026-03-11T00:00:00.000Z" })).toEqual([
      expect.objectContaining({
        event_type: "brief_opened",
      }),
    ]);
    expect(listProductEvents(storage, { types: ["program_created"] })).toEqual([
      expect.objectContaining({
        event_type: "program_created",
      }),
    ]);
  });

  it("derives metrics overview from recent product events", () => {
    storage.run(
      "INSERT INTO briefings (id, status, generated_at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
      [
        "brief-1", "ready", "2026-03-10T09:00:00.000Z",
        "brief-2", "ready", "2026-03-10T11:00:00.000Z",
        "brief-3", "ready", "2026-03-11T11:00:00.000Z",
      ],
    );

    recordProductEvent(storage, {
      eventType: "brief_opened",
      briefId: "brief-1",
      occurredAt: "2026-03-10T10:00:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "belief_corrected",
      briefId: "brief-1",
      beliefId: "belief-1",
      occurredAt: "2026-03-10T10:30:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "brief_opened",
      briefId: "brief-2",
      occurredAt: "2026-03-10T11:15:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "brief_action_created",
      briefId: "brief-2",
      actionId: "action-1",
      occurredAt: "2026-03-10T11:45:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "brief_action_completed",
      briefId: "brief-2",
      actionId: "action-1",
      occurredAt: "2026-03-10T12:15:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "brief_followup_asked",
      briefId: "brief-2",
      threadId: "thread-1",
      occurredAt: "2026-03-10T12:45:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "brief_opened",
      briefId: "brief-3",
      occurredAt: "2026-03-11T12:00:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "recommendation_accepted",
      briefId: "brief-3",
      occurredAt: "2026-03-11T12:10:00.000Z",
    });
    recordProductEvent(storage, {
      eventType: "telegram_brief_interaction",
      briefId: "brief-3",
      occurredAt: "2026-03-11T12:20:00.000Z",
    });

    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-03-12T00:00:00.000Z"));

    expect(getProductMetricsOverview(storage, 30)).toEqual({
      rangeDays: 30,
      generatedBriefs: 3,
      openedBriefs: 3,
      briefOpenRate: 1,
      trustedDecisionLoops: 3,
      trustedDecisionLoopRate: 1,
      briefActionCreatedCount: 1,
      briefActionCompletedCount: 1,
      actionConversionRate: 1 / 3,
      followUpQuestionsCount: 1,
      followUpRate: 1 / 3,
      beliefCorrectionsCount: 1,
      recommendationAcceptedCount: 1,
      telegramInteractionCount: 1,
      medianCorrectionLatencyMinutes: 30,
    });
  });
});
