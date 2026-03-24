import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, memoryMigrations, productEventMigrations, recordProductEvent } from "@personal-ai/core";
import { scheduleMigrations } from "@personal-ai/plugin-schedules";
import { taskMigrations } from "@personal-ai/plugin-tasks";
import { createFinding, createInsight, findingsMigrations, insightMigrations } from "@personal-ai/library";
import { digestRatingsMigrations, rateDigest } from "../src/digest-ratings.js";
import { briefingMigrations } from "../src/briefing.js";
import { insertLearningRun, learningMigrations, updateLearningRun } from "../src/learning.js";
import { getSystemQualityScore } from "../src/quality.js";

describe("getSystemQualityScore", () => {
  let dir: string;
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-quality-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
    storage.migrate("product_events", productEventMigrations);
    storage.migrate("learning", learningMigrations);
    storage.migrate("schedules", scheduleMigrations);
    storage.migrate("tasks", taskMigrations);
    storage.migrate("findings", findingsMigrations);
    storage.migrate("topic_insights", insightMigrations);
    storage.migrate("briefings", briefingMigrations);
    storage.migrate("digest_ratings", digestRatingsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("computes recent learning, memory, feedback, and compounding quality ratios", () => {
    storage.run(
      `INSERT INTO beliefs (
        id, statement, confidence, status, type, importance, subject, origin, freshness_at, correction_state, sensitive, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["b1", "User prefers concise status reports", 0.82, "active", "preference", 8, "owner", "user-said", "2026-03-01T00:00:00Z", "active", 0, 3],
    );
    storage.run(
      `INSERT INTO beliefs (
        id, statement, confidence, status, type, importance, subject, origin, freshness_at, correction_state, sensitive, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["b2", "User values reproducible builds", 0.74, "active", "preference", 7, "owner", "user-said", "2026-03-01T00:00:00Z", "active", 0, 1],
    );
    storage.run(
      `INSERT INTO beliefs (
        id, statement, confidence, status, type, importance, subject, origin, freshness_at, correction_state, sensitive, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["b3", "User follows infrastructure releases", 0.6, "active", "factual", 6, "owner", "inferred", "2026-03-01T00:00:00Z", "active", 0, 5],
    );
    storage.run(
      `INSERT INTO beliefs (
        id, statement, confidence, status, type, importance, subject, origin, freshness_at, correction_state, sensitive, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["b4", "Old assumption", 0.4, "invalidated", "factual", 5, "owner", "inferred", "2026-03-01T00:00:00Z", "invalidated", 0, 0],
    );
    storage.run(
      `INSERT INTO beliefs (
        id, statement, confidence, status, type, importance, subject, origin, freshness_at, correction_state, sensitive, access_count, supersedes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["b5", "Updated assumption", 0.86, "active", "factual", 5, "owner", "user-said", "2026-03-21T09:30:00Z", "confirmed", 0, 1, "b4"],
    );
    storage.run("UPDATE beliefs SET superseded_by = ? WHERE id = ?", ["b5", "b4"]);
    storage.run(
      "INSERT INTO belief_provenance (id, belief_id, source_kind, source_id, source_label, relation) VALUES (?, ?, ?, ?, ?, ?)",
      ["bp1", "b1", "episode", "ep1", "Episode 1", "observed"],
    );
    storage.run(
      "INSERT INTO belief_provenance (id, belief_id, source_kind, source_id, source_label, relation) VALUES (?, ?, ?, ?, ?, ?)",
      ["bp2", "b2", "episode", "ep2", "Episode 2", "observed"],
    );
    storage.run(
      "INSERT INTO belief_provenance (id, belief_id, source_kind, source_id, source_label, relation) VALUES (?, ?, ?, ?, ?, ?)",
      ["bp3", "b5", "briefing", "brief-2", "Digest correction", "prompted-correction"],
    );

    const successRun = insertLearningRun(storage, "2026-03-20T10:00:00Z");
    updateLearningRun(storage, successRun, {
      status: "done",
      completedAt: "2026-03-20T10:01:00Z",
      threadsCount: 1,
      messagesCount: 4,
      factsExtracted: 4,
      beliefsCreated: 1,
      beliefsReinforced: 2,
      durationMs: 1_000,
    });
    const failedRun = insertLearningRun(storage, "2026-03-21T10:00:00Z");
    updateLearningRun(storage, failedRun, {
      status: "error",
      completedAt: "2026-03-21T10:01:00Z",
      threadsCount: 1,
      messagesCount: 2,
      error: "provider timeout",
      durationMs: 1_000,
    });

    storage.run(
      "INSERT INTO briefings (id, generated_at, sections, status, type, source_kind) VALUES (?, ?, ?, ?, ?, ?)",
      ["brief-1", "2026-03-20T09:00:00Z", "{}", "ready", "daily", "maintenance"],
    );
    storage.run(
      "INSERT INTO briefings (id, generated_at, sections, status, type, source_kind) VALUES (?, ?, ?, ?, ?, ?)",
      ["brief-2", "2026-03-21T09:00:00Z", "{}", "ready", "daily", "maintenance"],
    );
    storage.run(
      "INSERT INTO briefings (id, generated_at, sections, status, type, source_kind) VALUES (?, ?, ?, ?, ?, ?)",
      ["brief-3", "2026-03-22T09:00:00Z", "{}", "ready", "daily", "maintenance"],
    );
    recordProductEvent(storage, {
      eventType: "brief_opened",
      occurredAt: "2026-03-20T09:05:00Z",
      briefId: "brief-1",
    });
    recordProductEvent(storage, {
      eventType: "brief_opened",
      occurredAt: "2026-03-21T09:05:00Z",
      briefId: "brief-2",
    });
    recordProductEvent(storage, {
      eventType: "recommendation_accepted",
      occurredAt: "2026-03-20T09:10:00Z",
      briefId: "brief-1",
    });
    rateDigest(storage, "brief-1", 4, "Useful");
    recordProductEvent(storage, {
      eventType: "belief_corrected",
      occurredAt: "2026-03-21T10:00:00Z",
      briefId: "brief-2",
      beliefId: "b5",
    });
    storage.run(
      "INSERT INTO brief_beliefs (id, brief_id, belief_id, role) VALUES (?, ?, ?, ?)",
      ["bb-1", "brief-3", "b5", "assumption"],
    );
    storage.run(
      "INSERT INTO tasks (id, title, description, status, priority, created_at, completed_at, source_type, source_id, source_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["task-1", "Follow updated assumption", null, "done", "medium", "2026-03-20T09:15:00Z", "2026-03-20T12:00:00Z", "briefing", "brief-1", "Brief 1"],
    );
    storage.run(
      "INSERT INTO tasks (id, title, description, status, priority, created_at, completed_at, source_type, source_id, source_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["task-2", "Re-check platform choice", null, "open", "high", "2026-03-21T09:15:00Z", null, "briefing", "brief-2", "Brief 2"],
    );
    recordProductEvent(storage, {
      eventType: "brief_action_completed",
      occurredAt: "2026-03-20T12:00:00Z",
      briefId: "brief-1",
      actionId: "task-1",
    });

    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["watch-1", "Infra Watch", "research", "Track inference infra", 24],
    );
    const sourcesA = [
      { url: "https://www.sec.gov/ixviewer/ix.html", title: "SEC filing", fetchedAt: "2026-03-20T09:00:00Z", relevance: 0.9 },
      { url: "https://www.reuters.com/technology/example", title: "Reuters", fetchedAt: "2026-03-20T09:00:00Z", relevance: 0.85 },
    ];
    const sourcesB = [
      { url: "https://docs.anthropic.com/en/docs/overview", title: "Documentation", fetchedAt: "2026-03-21T09:00:00Z", relevance: 0.85 },
      { url: "https://www.theverge.com/ai/example", title: "The Verge", fetchedAt: "2026-03-21T09:00:00Z", relevance: 0.8 },
    ];
    const sourcesC = [
      { url: "https://example.com/analysis", title: "Independent analysis", fetchedAt: "2026-03-22T09:00:00Z", relevance: 0.8 },
    ];
    const finding1 = createFinding(storage, { watchId: "watch-1", goal: "Inference infra", domain: "general", summary: "Vendor consolidation is accelerating", confidence: 0.8, agentName: "test", depthLevel: "standard", sources: sourcesA });
    const finding2 = createFinding(storage, {
      watchId: "watch-1",
      goal: "Inference infra",
      domain: "general",
      summary: "Teams are standardizing evals",
      confidence: 0.82,
      agentName: "test",
      depthLevel: "standard",
      sources: sourcesB,
      previousFindingId: finding1.id,
      delta: { changed: ["+ Teams are standardizing evals"], significance: 0.45 },
    });
    const finding3 = createFinding(storage, {
      watchId: "watch-1",
      goal: "Inference infra",
      domain: "general",
      summary: "Platform choices narrowed further",
      confidence: 0.79,
      agentName: "test",
      depthLevel: "standard",
      sources: sourcesC,
      previousFindingId: finding2.id,
      delta: { changed: ["+ Minor wording update"], significance: 0.08 },
    });
    createInsight(storage, {
      watchId: "watch-1",
      topic: "Infra Watch",
      insight: "Inference stacks are consolidating around fewer platform vendors",
      confidence: 0.84,
      sources: [finding1.id, finding2.id, finding3.id],
    });

    const quality = getSystemQualityScore(storage);

    expect(quality.memory.utilization).toBe(100);
    expect(quality.memory.reinforcementRate).toBe(75);
    expect(quality.memory.provenanceCoverage).toBe(75);
    expect(quality.learning.successRate).toBe(50);
    expect(quality.learning.acceptanceRate).toBe(75);
    expect(quality.feedback.activity).toBe(67);
    expect(quality.feedback.avgRating).toBe(4);
    expect(quality.knowledge.coverage).toBe(100);
    expect(quality.knowledge.evidenceCoverage).toBe(100);
    expect(quality.knowledge.findingSourceCoverage).toBe(100);
    expect(quality.knowledge.authoritativeFindingCoverage).toBe(67);
    expect(quality.knowledge.primaryFindingCoverage).toBe(67);
    expect(quality.knowledge.chainedFindings).toBe(2);
    expect(quality.knowledge.noveltyCoverage).toBe(50);
    expect(quality.knowledge.highConfidenceFindings).toBe(3);
    expect(quality.knowledge.highConfidenceNovelFindings).toBe(2);
    expect(quality.knowledge.highConfidenceAuthoritativeFindings).toBe(2);
    expect(quality.knowledge.supportedHighConfidenceFindings).toBe(2);
    expect(quality.domains.trust.metrics.find((metric) => metric.key === "provenanceCoverage")?.value).toBe(75);
    expect(quality.domains.loopEfficacy.metrics.find((metric) => metric.key === "eligibleWatchCoverage")?.value).toBe(100);
    expect(quality.domains.reliability.metrics.find((metric) => metric.key === "failedSignalRunRate")?.value).toBe(50);
    expect(quality.domains.userValue.metrics.find((metric) => metric.key === "averageDigestRating")?.value).toBe(80);
    expect(quality.domains.userValue.metrics.find((metric) => metric.key === "recommendationAcceptanceRate")?.value).toBe(50);
    expect(quality.domains.userValue.metrics.find((metric) => metric.key === "briefActionCompletionRate")?.value).toBe(50);
    expect(quality.domains.userValue.metrics.find((metric) => metric.key === "correctionCarryForwardRate")?.value).toBe(100);
    expect(quality.domains.userValue.metrics.find((metric) => metric.key === "trustedDecisionLoopRate")?.value).toBe(100);
    expect(quality.blockingDomains).toEqual([]);
    expect(quality.status).toBe("insufficient_data");
    expect(quality.score).toBeGreaterThan(0);
  });

  it("treats findings-only learning runs as signal-bearing", () => {
    const runId = insertLearningRun(storage, "2026-03-22T10:00:00Z");
    updateLearningRun(storage, runId, {
      status: "done",
      completedAt: "2026-03-22T10:01:00Z",
      findingsCount: 2,
      digestsCount: 1,
      factsExtracted: 2,
      beliefsCreated: 1,
      durationMs: 1_000,
    });

    const quality = getSystemQualityScore(storage);

    expect(quality.learning.signalBearingRuns).toBe(1);
    expect(quality.learning.successRate).toBe(100);
    expect(quality.learning.acceptanceRate).toBe(50);
    expect(quality.learning.yieldRate).toBe(100);
  });

  it("only counts active watches with credible findings toward compounding coverage", () => {
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["watch-eligible", "Eligible Watch", "research", "Track credible signals", 24],
    );
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["watch-weak", "Weak Watch", "research", "Track weak signals", 24],
    );

    const strongSources = [
      { url: "https://www.sec.gov/ixviewer/ix.html", title: "SEC filing", fetchedAt: "2026-03-20T09:00:00Z", relevance: 0.9 },
      { url: "https://www.reuters.com/technology/example", title: "Reuters", fetchedAt: "2026-03-20T09:00:00Z", relevance: 0.85 },
    ];
    for (let i = 0; i < 3; i++) {
      createFinding(storage, {
        watchId: "watch-eligible",
        goal: "Credible signals",
        domain: "general",
        summary: `Credible finding ${i + 1}`,
        confidence: 0.8,
        agentName: "test",
        depthLevel: "standard",
        sources: strongSources,
      });
      createFinding(storage, {
        watchId: "watch-weak",
        goal: "Weak signals",
        domain: "general",
        summary: `Weak finding ${i + 1}`,
        confidence: 0.4,
        agentName: "test",
        depthLevel: "standard",
        sources: [{ url: `https://example.com/weak-${i}`, title: "Weak source", fetchedAt: "2026-03-20T09:00:00Z", relevance: 0.6 }],
      });
    }

    createInsight(storage, {
      watchId: "watch-eligible",
      topic: "Eligible Watch",
      insight: "Credible cycles are compounding into a durable signal",
      confidence: 0.82,
      sources: ["f1", "f2"],
    });

    const quality = getSystemQualityScore(storage);

    expect(quality.knowledge.eligibleWatches).toBe(1);
    expect(quality.knowledge.coveredWatches).toBe(1);
    expect(quality.knowledge.coverage).toBe(100);
  });

  it("caps the overall score when a sufficiently sampled domain is failing", () => {
    for (let i = 0; i < 5; i++) {
      storage.run(
        `INSERT INTO beliefs (
          id, statement, confidence, status, type, importance, subject, origin, freshness_at, correction_state, sensitive, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`active-${i}`, `Active belief ${i + 1}`, 0.82, "active", "factual", 7, "owner", "inferred", "2026-03-01T00:00:00Z", "active", 0, 3],
      );
      storage.run(
        `INSERT INTO beliefs (
          id, statement, confidence, status, type, importance, subject, origin, freshness_at, correction_state, sensitive, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`invalid-${i}`, `Invalidated belief ${i + 1}`, 0.3, "invalidated", "factual", 5, "owner", "inferred", "2026-03-01T00:00:00Z", "invalidated", 0, 0],
      );
    }

    for (let i = 0; i < 3; i++) {
      const runId = insertLearningRun(storage, `2026-03-2${i}T10:00:00Z`);
      updateLearningRun(storage, runId, {
        status: i === 0 ? "done" : "error",
        completedAt: `2026-03-2${i}T10:01:00Z`,
        threadsCount: 1,
        messagesCount: 2,
        factsExtracted: i === 0 ? 2 : 0,
        beliefsCreated: i === 0 ? 1 : 0,
        error: i === 0 ? undefined : "provider timeout",
        durationMs: 1_000,
      });
    }

    for (let i = 0; i < 3; i++) {
      createFinding(storage, {
        goal: "Reliability checks",
        domain: "general",
        summary: `Finding ${i + 1}`,
        confidence: 0.6,
        agentName: "test",
        depthLevel: "standard",
        sources: [{ url: `https://example.com/source-${i}`, title: "Source", fetchedAt: "2026-03-20T09:00:00Z", relevance: 0.8 }],
      });
    }

    const quality = getSystemQualityScore(storage);

    expect(quality.domains.reliability.status).toBe("bad");
    expect(quality.blockingDomains).toEqual(["reliability"]);
    expect(quality.status).toBe("bad");
    expect(quality.score).toBeLessThanOrEqual(60);
  });

  it("does not give sparse low-confidence datasets free high-confidence quality credit", () => {
    storage.run(
      "INSERT INTO scheduled_jobs (id, label, type, goal, interval_hours, next_run_at, status) VALUES (?, ?, ?, ?, ?, datetime('now'), 'active')",
      ["watch-sparse", "Sparse Watch", "research", "Track sparse signals", 24],
    );

    for (let i = 0; i < 3; i++) {
      createFinding(storage, {
        watchId: "watch-sparse",
        goal: "Sparse signals",
        domain: "general",
        summary: `Sparse finding ${i + 1}`,
        confidence: 0.5,
        agentName: "test",
        depthLevel: "standard",
        sources: [{ url: `https://example.com/sparse-${i}`, title: "Independent analysis", fetchedAt: "2026-03-20T09:00:00Z", relevance: 0.7 }],
      });
    }

    const quality = getSystemQualityScore(storage);

    expect(quality.knowledge.highConfidenceFindings).toBe(0);
    expect(quality.blockingDomains).toEqual([]);
    expect(quality.status).toBe("insufficient_data");
    expect(quality.knowledge.score).toBeLessThan(40);
    expect(quality.score).toBe(0);
  });

  it("gracefully handles missing optional quality tables", () => {
    const minimalDir = mkdtempSync(join(tmpdir(), "pai-quality-minimal-"));
    const minimalStorage = createStorage(minimalDir);

    try {
      minimalStorage.migrate("memory", memoryMigrations);
      minimalStorage.migrate("learning", learningMigrations);

      const quality = getSystemQualityScore(minimalStorage);

      expect(quality.learning.recentRuns).toBe(0);
      expect(quality.knowledge.watchesActive).toBe(0);
      expect(quality.knowledge.findings).toBe(0);
      expect(quality.feedback.totalDigests).toBe(0);
      expect(quality.blockingDomains).toEqual([]);
      expect(quality.status).toBe("insufficient_data");
      expect(quality.domains.userValue.status).toBe("insufficient_data");
    } finally {
      minimalStorage.close();
      rmSync(minimalDir, { recursive: true, force: true });
    }
  });
});
