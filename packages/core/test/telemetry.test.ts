import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "../src/storage.js";
import {
  cleanupOldTelemetrySpans,
  createChildTelemetry,
  finishSpan,
  getJobDiagnostics,
  getObservabilityOverview,
  getThreadDiagnostics,
  getTraceSpans,
  instrumentedEmbed,
  listProcessAggregates,
  listRecentErrors,
  startSpan,
  telemetryMigrations,
} from "../src/telemetry.js";
import { appendMessages, createThread, threadMigrations } from "../src/threads.js";
import type { Storage } from "../src/types.js";

describe("telemetry", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-telemetry-test-"));
    storage = createStorage(dir);
    storage.migrate("threads", threadMigrations);
    storage.migrate("telemetry", telemetryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates observability overview without double-counting tool spans", () => {
    const runtime = { storage };
    const rootSpan = startSpan(runtime, {
      spanType: "llm",
      process: "chat.main",
      surface: "web",
      provider: "openai",
      model: "gpt-4.1-mini",
      threadId: "thread-agg",
      metadata: { phase: "response" },
    });
    rootSpan.startedAt = new Date(Date.now() - 1_200).toISOString();
    finishSpan(runtime, rootSpan, {
      status: "ok",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      stepCount: 2,
      responseSizeChars: 42,
    });

    const childAttrs = createChildTelemetry(rootSpan, {
      toolName: "web_search",
      metadata: { source: "search" },
    });
    expect(childAttrs.traceId).toBe(rootSpan.traceId);
    expect(childAttrs.parentSpanId).toBe(rootSpan.id);
    expect(childAttrs.process).toBe("chat.main");

    const toolSpan = startSpan(runtime, {
      ...childAttrs,
      spanType: "tool",
      toolName: "web_search",
    });
    toolSpan.startedAt = new Date(Date.now() - 900).toISOString();
    finishSpan(runtime, toolSpan, {
      status: "ok",
      inputTokens: 99,
      outputTokens: 1,
      totalTokens: 100,
      responseSizeChars: 12,
    });

    const failedWorkerSpan = startSpan(runtime, {
      spanType: "worker",
      process: "worker.schedule",
      surface: "worker",
      runId: "run-1",
    });
    failedWorkerSpan.startedAt = new Date(Date.now() - 400).toISOString();
    finishSpan(runtime, failedWorkerSpan, {
      status: "error",
      errorMessage: "schedule failed",
    });

    const overview = getObservabilityOverview(storage, "24h");
    expect(overview.totals.calls).toBe(2);
    expect(overview.totals.totalTokens).toBe(15);
    expect(overview.totals.errors).toBe(1);
    expect(overview.topProcesses[0]?.process).toBe("chat.main");
    expect(overview.topProcesses[0]?.calls).toBe(1);
    expect(overview.topModels).toEqual([
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4.1-mini",
        totalTokens: 15,
      }),
    ]);

    const processes = listProcessAggregates(storage, "24h");
    expect(processes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ process: "chat.main", calls: 1, totalTokens: 15 }),
        expect.objectContaining({ process: "worker.schedule", calls: 1, errors: 1 }),
      ]),
    );

    const traceSpans = getTraceSpans(storage, rootSpan.traceId);
    expect(traceSpans).toHaveLength(2);
    expect(traceSpans.map((span) => span.spanType)).toEqual(["llm", "tool"]);

    const recentErrors = listRecentErrors(storage, "24h");
    expect(recentErrors).toEqual([
      expect.objectContaining({
        process: "worker.schedule",
        errorMessage: "schedule failed",
      }),
    ]);
  });

  it("returns thread and job diagnostics while preserving detailed recent spans", () => {
    const runtime = { storage };
    const thread = createThread(storage, { title: "Telemetry thread" });

    const threadRootSpan = startSpan(runtime, {
      spanType: "llm",
      process: "chat.main",
      surface: "web",
      threadId: thread.id,
      provider: "openai",
      model: "gpt-4.1-mini",
    });
    finishSpan(runtime, threadRootSpan, {
      status: "ok",
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      stepCount: 3,
      responseSizeChars: 64,
    });

    const threadToolSpan = startSpan(runtime, {
      ...createChildTelemetry(threadRootSpan, { toolName: "knowledge_search" }),
      spanType: "tool",
      toolName: "knowledge_search",
    });
    finishSpan(runtime, threadToolSpan, {
      status: "ok",
      totalTokens: 5,
      responseSizeChars: 18,
    });

    appendMessages(storage, thread.id, [
      { role: "user", content: "How should we test telemetry?" },
      {
        role: "assistant",
        content: "Record spans and inspect diagnostics.",
        usageJson: JSON.stringify({
          traceId: threadRootSpan.traceId,
          process: "chat.main",
          provider: "openai",
          model: "gpt-4.1-mini",
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          durationMs: 120,
          stepCount: 3,
          toolCallCount: 1,
        }),
      },
    ]);

    const threadDiagnostics = getThreadDiagnostics(storage, thread.id);
    expect(threadDiagnostics.totals.calls).toBe(1);
    expect(threadDiagnostics.totals.totalTokens).toBe(20);
    expect(threadDiagnostics.processBreakdown).toEqual([
      expect.objectContaining({ process: "chat.main", calls: 1, totalTokens: 20 }),
    ]);
    expect(threadDiagnostics.messages.at(-1)?.usage).toEqual(
      expect.objectContaining({
        traceId: threadRootSpan.traceId,
        totalTokens: 20,
        toolCallCount: 1,
      }),
    );

    const researcherSpan = startSpan(runtime, {
      spanType: "llm",
      process: "swarm.agent",
      surface: "worker",
      jobId: "job-1",
      agentName: "researcher",
      provider: "openai",
      model: "gpt-4.1-mini",
    });
    finishSpan(runtime, researcherSpan, {
      status: "ok",
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      stepCount: 2,
    });

    const researcherToolSpan = startSpan(runtime, {
      ...createChildTelemetry(researcherSpan, { toolName: "web_search" }),
      spanType: "tool",
      toolName: "web_search",
      agentName: "researcher",
    });
    finishSpan(runtime, researcherToolSpan, {
      status: "ok",
      totalTokens: 7,
      responseSizeChars: 15,
    });

    const synthSpan = startSpan(runtime, {
      spanType: "llm",
      process: "swarm.synthesize",
      surface: "worker",
      jobId: "job-1",
      agentName: "synthesizer",
      provider: "openai",
      model: "gpt-4.1-mini",
    });
    finishSpan(runtime, synthSpan, {
      status: "ok",
      inputTokens: 25,
      outputTokens: 15,
      totalTokens: 40,
    });

    const jobDiagnostics = getJobDiagnostics(storage, "job-1");
    expect(jobDiagnostics.totals.calls).toBe(2);
    expect(jobDiagnostics.totals.totalTokens).toBe(70);
    expect(jobDiagnostics.processBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ process: "swarm.agent", calls: 1, totalTokens: 30 }),
        expect.objectContaining({ process: "swarm.synthesize", calls: 1, totalTokens: 40 }),
      ]),
    );
    expect(jobDiagnostics.agentBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentName: "researcher", totalTokens: 30 }),
        expect.objectContaining({ agentName: "synthesizer", totalTokens: 40 }),
      ]),
    );
    expect(jobDiagnostics.recentSpans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ spanType: "tool", toolName: "web_search" }),
      ]),
    );
  });

  it("cleans up old spans and persists embed success and failure spans", async () => {
    const runtime = { storage };

    const oldSpan = startSpan(runtime, {
      spanType: "worker",
      process: "worker.cleanup",
      surface: "worker",
    });
    oldSpan.startedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    finishSpan(runtime, oldSpan, { status: "ok" });

    const removed = cleanupOldTelemetrySpans(storage, 30);
    expect(removed).toBe(1);

    const { result } = await instrumentedEmbed(
      runtime,
      {
        spanType: "embed",
        process: "embed.memory",
        surface: "web",
        provider: "openai",
        model: "text-embedding-3-small",
      },
      async () => ({
        result: { embedding: [0.1, 0.2, 0.3] },
        responseSizeChars: 3,
        inputTokens: 6,
        totalTokens: 6,
        metadata: { mode: "remote" },
      }),
    );
    expect(result.embedding).toHaveLength(3);

    await expect(
      instrumentedEmbed(
        runtime,
        {
          spanType: "embed",
          process: "embed.knowledge",
          surface: "worker",
          provider: "openai",
          model: "text-embedding-3-small",
        },
        async () => {
          throw new Error("embedding failed");
        },
      ),
    ).rejects.toThrow("embedding failed");

    const rows = storage.query<{
      process: string;
      status: string;
      error_message: string | null;
      total_tokens: number | null;
    }>(
      "SELECT process, status, error_message, total_tokens FROM telemetry_spans WHERE span_type = 'embed' ORDER BY rowid ASC",
    );
    expect(rows).toEqual([
      {
        process: "embed.memory",
        status: "ok",
        error_message: null,
        total_tokens: 6,
      },
      {
        process: "embed.knowledge",
        status: "error",
        error_message: "embedding failed",
        total_tokens: null,
      },
    ]);
  });
});
