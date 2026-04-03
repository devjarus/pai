import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@personal-ai/core";

const mockGetLlmTrafficConfig = vi.fn();
const mockGetLlmTrafficSnapshot = vi.fn();
const mockUpsertJob = vi.fn();

const mockCreateResearchJob = vi.fn();
const mockListPendingResearchJobs = vi.fn();
const mockRunResearchInBackground = vi.fn();

const mockCreateSwarmJob = vi.fn();
const mockListPendingSwarmJobs = vi.fn();
const mockRunSwarmInBackground = vi.fn();

const mockEnqueueBriefingGeneration = vi.fn();
const mockGenerateBriefing = vi.fn();
const mockListPendingDailyBriefings = vi.fn();

vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    getLlmTrafficConfig: (...args: unknown[]) => mockGetLlmTrafficConfig(...args),
    getLlmTrafficSnapshot: (...args: unknown[]) => mockGetLlmTrafficSnapshot(...args),
    upsertJob: (...args: unknown[]) => mockUpsertJob(...args),
  };
});

vi.mock("@personal-ai/plugin-research", () => ({
  createResearchJob: (...args: unknown[]) => mockCreateResearchJob(...args),
  listPendingResearchJobs: (...args: unknown[]) => mockListPendingResearchJobs(...args),
  runResearchInBackground: (...args: unknown[]) => mockRunResearchInBackground(...args),
}));

vi.mock("@personal-ai/plugin-swarm", () => ({
  createSwarmJob: (...args: unknown[]) => mockCreateSwarmJob(...args),
  listPendingSwarmJobs: (...args: unknown[]) => mockListPendingSwarmJobs(...args),
  runSwarmInBackground: (...args: unknown[]) => mockRunSwarmInBackground(...args),
}));

vi.mock("../src/briefing.js", () => ({
  enqueueBriefingGeneration: (...args: unknown[]) => mockEnqueueBriefingGeneration(...args),
  generateBriefing: (...args: unknown[]) => mockGenerateBriefing(...args),
  listPendingDailyBriefings: (...args: unknown[]) => mockListPendingDailyBriefings(...args),
}));

vi.mock("@personal-ai/plugin-assistant/web-search", () => ({
  webSearch: vi.fn(),
  formatSearchResults: vi.fn(),
}));

vi.mock("@personal-ai/plugin-assistant/page-fetch", () => ({
  fetchPageAsMarkdown: vi.fn(),
}));

import { BackgroundDispatcher } from "../src/background-dispatcher.js";

function makeCtx(): PluginContext {
  return {
    config: {
      dataDir: "/tmp/test",
      logLevel: "silent",
      llm: {
        provider: "ollama",
        model: "llama3.2",
        baseUrl: "http://127.0.0.1:11434",
      },
      plugins: [],
    },
    storage: {
      query: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      migrate: vi.fn(),
      close: vi.fn(),
    } as unknown as PluginContext["storage"],
    llm: {
      getModel: vi.fn(),
      health: vi.fn().mockResolvedValue({ ok: true }),
      embed: vi.fn(),
    } as unknown as PluginContext["llm"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as PluginContext;
}

describe("BackgroundDispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetLlmTrafficConfig.mockReturnValue({
      maxConcurrent: 1,
      startGapMs: 0,
      startupDelayMs: 0,
      swarmAgentConcurrency: 1,
    });
    mockGetLlmTrafficSnapshot.mockReturnValue({
      active: { interactive: 0, deferred: 0, background: 0 },
      queued: { interactive: 0, deferred: 0, background: 0 },
      activeTotal: 0,
      queuedTotal: 0,
    });
    mockListPendingResearchJobs.mockReturnValue([]);
    mockListPendingSwarmJobs.mockReturnValue([]);
    mockListPendingDailyBriefings.mockReturnValue([]);
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it("orders pending work by manual, then schedule, then maintenance", () => {
    mockListPendingResearchJobs.mockReturnValue([
      { id: "research-schedule", queuedAt: "2026-03-05T10:00:00.000Z", sourceKind: "schedule" },
      { id: "research-manual", queuedAt: "2026-03-05T11:00:00.000Z", sourceKind: "manual" },
    ]);
    mockListPendingSwarmJobs.mockReturnValue([
      { id: "swarm-maintenance", queuedAt: "2026-03-05T09:00:00.000Z", sourceKind: "maintenance" },
    ]);

    const dispatcher = new BackgroundDispatcher(makeCtx());
    const state = dispatcher.getWorkState();

    expect(state.pending.map((item) => item.id)).toEqual([
      "research-manual",
      "research-schedule",
      "swarm-maintenance",
    ]);
  });

  it("dispatches only one background job at a time", async () => {
    let releaseRun: (() => void) | null = null;
    mockListPendingResearchJobs.mockReturnValue([
      { id: "job-1", queuedAt: "2026-03-05T10:00:00.000Z", sourceKind: "manual" },
    ]);
    mockRunResearchInBackground.mockImplementation(() => new Promise<void>((resolve) => {
      releaseRun = resolve;
    }));

    const dispatcher = new BackgroundDispatcher(makeCtx());
    dispatcher.start();

    await vi.runAllTimersAsync();
    expect(mockRunResearchInBackground).toHaveBeenCalledTimes(1);

    dispatcher.nudge();
    await vi.runAllTimersAsync();
    expect(mockRunResearchInBackground).toHaveBeenCalledTimes(1);

    releaseRun?.();
    await vi.runAllTimersAsync();
    dispatcher.stop();
  });

  it("re-queues transient recurring research failures with backoff", async () => {
    mockListPendingResearchJobs
      .mockReturnValueOnce([
        { id: "job-1", queuedAt: "2026-03-05T10:00:00.000Z", sourceKind: "schedule" },
      ])
      .mockReturnValue([]);
    mockRunResearchInBackground.mockRejectedValue(new Error("503 Service Unavailable"));

    const ctx = makeCtx();
    (ctx.storage.query as unknown as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if (sql.includes("SELECT attempt_count FROM background_jobs WHERE id = ?")) {
        return [{ attempt_count: 0 }];
      }
      return [];
    });

    const dispatcher = new BackgroundDispatcher(ctx);
    dispatcher.start();

    await vi.runAllTimersAsync();

    expect(ctx.storage.run).toHaveBeenCalledWith(
      "UPDATE research_jobs SET status = 'pending' WHERE id = ? AND status = 'failed'",
      ["job-1"],
    );
    expect(ctx.storage.run).toHaveBeenCalledWith(
      "UPDATE background_jobs SET status = 'pending', progress = ?, error = ? WHERE id = ?",
      [expect.stringContaining("retry 1/2 in 30s"), "503 Service Unavailable", "job-1"],
    );

    dispatcher.stop();
  });
});
