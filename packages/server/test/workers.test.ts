import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerLoop, buildEnrichedResearchGoal } from "../src/workers.js";
import type { PluginContext } from "@personal-ai/core";

// ---------------------------------------------------------------------------
// Mock all external dependencies so we test WorkerLoop in isolation
// ---------------------------------------------------------------------------
const mockGetLatestBriefing = vi.fn().mockReturnValue(null);
vi.mock("../src/briefing.js", () => ({
  getLatestBriefing: (...args: unknown[]) => mockGetLatestBriefing(...args),
}));

const mockRunBackgroundLearning = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/learning.js", () => ({
  runBackgroundLearning: (...args: unknown[]) => mockRunBackgroundLearning(...args),
}));

const mockGetDueSchedules = vi.fn().mockReturnValue([]);
const mockMarkScheduleRun = vi.fn();
vi.mock("@personal-ai/plugin-schedules", () => ({
  getDueSchedules: (...args: unknown[]) => mockGetDueSchedules(...args),
  markScheduleRun: (...args: unknown[]) => mockMarkScheduleRun(...args),
}));

const mockCreateResearchJob = vi.fn().mockReturnValue("job-1");
const mockRunResearchInBackground = vi.fn().mockResolvedValue(undefined);
vi.mock("@personal-ai/plugin-research", () => ({
  createResearchJob: (...args: unknown[]) => mockCreateResearchJob(...args),
  runResearchInBackground: (...args: unknown[]) => mockRunResearchInBackground(...args),
}));

const mockCreateSwarmJob = vi.fn().mockReturnValue("swarm-1");
const mockRunSwarmInBackground = vi.fn().mockResolvedValue(undefined);
vi.mock("@personal-ai/plugin-swarm", () => ({
  createSwarmJob: (...args: unknown[]) => mockCreateSwarmJob(...args),
  runSwarmInBackground: (...args: unknown[]) => mockRunSwarmInBackground(...args),
}));

vi.mock("@personal-ai/plugin-assistant/web-search", () => ({
  webSearch: vi.fn(),
  formatSearchResults: vi.fn(),
}));

vi.mock("@personal-ai/plugin-assistant/page-fetch", () => ({
  fetchPageAsMarkdown: vi.fn(),
}));

const mockListBeliefs = vi.fn().mockReturnValue([]);
const mockListThreads = vi.fn().mockReturnValue([]);
const mockSyncAutomaticLinearIssues = vi.fn().mockResolvedValue({
  created: 0,
  updated: 0,
  candidates: 0,
  skipped: 0,
  reason: "disabled",
});
vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    listBeliefs: (...args: unknown[]) => mockListBeliefs(...args),
    listThreads: (...args: unknown[]) => mockListThreads(...args),
    syncAutomaticLinearIssues: (...args: unknown[]) => mockSyncAutomaticLinearIssues(...args),
  };
});

function createMockCtx(): PluginContext {
  return {
    config: {
      dataDir: "/tmp",
      sandboxUrl: "http://sandbox",
      browserUrl: "http://browser",
      llm: { provider: "ollama" },
      plugins: [],
      logLevel: "silent",
    },
    storage: {
      query: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      migrate: vi.fn(),
      close: vi.fn(),
    },
    llm: {
      health: vi.fn().mockResolvedValue({ ok: true }),
      getModel: vi.fn(),
      embed: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    backgroundJobs: {
      enqueueResearch: vi.fn().mockResolvedValue("job-1"),
      enqueueSwarm: vi.fn().mockResolvedValue("swarm-1"),
      enqueueBriefing: vi.fn().mockResolvedValue("briefing-1"),
    },
  } as unknown as PluginContext;
}

describe("WorkerLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSyncAutomaticLinearIssues.mockResolvedValue({
      created: 0,
      updated: 0,
      candidates: 0,
      skipped: 0,
      reason: "disabled",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and stops cleanly", () => {
    const ctx = createMockCtx();
    const loop = new WorkerLoop(ctx, { generateInitialBriefing: false });

    loop.start();
    loop.stop();
    // No errors, no hanging timers
  });

  it("start() is idempotent — calling twice does not double timers", () => {
    const ctx = createMockCtx();
    const loop = new WorkerLoop(ctx, {
      briefingIntervalMs: 5000,
      scheduleCheckIntervalMs: 1000,
      learningIntervalMs: 5000,
      learningInitialDelayMs: 5000,
      generateInitialBriefing: false,
    });

    loop.start();
    loop.start(); // second call should be no-op

    vi.advanceTimersByTime(1000);

    // Schedule check should only fire once (not doubled by second start())
    expect(mockGetDueSchedules).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it("stop() is idempotent — calling twice is safe", () => {
    const ctx = createMockCtx();
    const loop = new WorkerLoop(ctx, { generateInitialBriefing: false });

    loop.start();
    loop.stop();
    loop.stop(); // should not throw
  });

  it("generates initial briefing when none exists and user has data", () => {
    const ctx = createMockCtx();
    mockGetLatestBriefing.mockReturnValue(null);
    mockListBeliefs.mockReturnValue([{ id: "b1" }]);

    const loop = new WorkerLoop(ctx, { generateInitialBriefing: true });
    loop.start();

    expect(mockGetLatestBriefing).toHaveBeenCalled();
    expect(ctx.backgroundJobs?.enqueueBriefing).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it("skips initial briefing when no user data exists", () => {
    const ctx = createMockCtx();
    mockGetLatestBriefing.mockReturnValue(null);
    mockListBeliefs.mockReturnValue([]);
    mockListThreads.mockReturnValue([]);

    const loop = new WorkerLoop(ctx, { generateInitialBriefing: true });
    loop.start();

    expect(ctx.backgroundJobs?.enqueueBriefing).not.toHaveBeenCalled();

    loop.stop();
  });

  it("skips initial briefing when one already exists", () => {
    const ctx = createMockCtx();
    mockGetLatestBriefing.mockReturnValue({ id: "existing" });

    const loop = new WorkerLoop(ctx, { generateInitialBriefing: true });
    loop.start();

    expect(mockGetLatestBriefing).toHaveBeenCalled();
    expect(ctx.backgroundJobs?.enqueueBriefing).not.toHaveBeenCalled();

    loop.stop();
  });

  it("runs briefing on interval", () => {
    const ctx = createMockCtx();
    mockGetLatestBriefing.mockReturnValue({ id: "existing" }); // skip initial

    const loop = new WorkerLoop(ctx, { briefingIntervalMs: 5000, generateInitialBriefing: true });
    loop.start();

    expect(ctx.backgroundJobs?.enqueueBriefing).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(ctx.backgroundJobs?.enqueueBriefing).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(ctx.backgroundJobs?.enqueueBriefing).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("runs schedule check on interval", () => {
    const ctx = createMockCtx();
    const loop = new WorkerLoop(ctx, {
      scheduleCheckIntervalMs: 2000,
      generateInitialBriefing: false,
    });
    loop.start();

    vi.advanceTimersByTime(2000);
    expect(mockGetDueSchedules).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(mockGetDueSchedules).toHaveBeenCalledTimes(2);

    loop.stop();
  });

  it("runs learning after initial delay", () => {
    const ctx = createMockCtx();
    const loop = new WorkerLoop(ctx, {
      learningInitialDelayMs: 3000,
      learningIntervalMs: 10000,
      generateInitialBriefing: false,
    });
    loop.start();

    expect(mockRunBackgroundLearning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(mockRunBackgroundLearning).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it("runs learning on interval", () => {
    const ctx = createMockCtx();
    const loop = new WorkerLoop(ctx, {
      learningInitialDelayMs: 100,
      learningIntervalMs: 5000,
      generateInitialBriefing: false,
    });
    loop.start();

    vi.advanceTimersByTime(5000);
    expect(mockRunBackgroundLearning).toHaveBeenCalledTimes(2); // initial delay + first interval

    loop.stop();
  });

  it("updateContext replaces internal context", () => {
    const ctx = createMockCtx();
    const loop = new WorkerLoop(ctx, {
      scheduleCheckIntervalMs: 1000,
      generateInitialBriefing: false,
    });
    loop.start();

    const newStorage = { query: vi.fn().mockReturnValue([]), run: vi.fn(), migrate: vi.fn(), close: vi.fn() };
    loop.updateContext({ storage: newStorage } as unknown as Partial<PluginContext>);

    vi.advanceTimersByTime(1000);

    // getDueSchedules should be called with the new storage
    expect(mockGetDueSchedules).toHaveBeenCalledWith(newStorage);

    loop.stop();
  });

  it("creates research jobs for due schedules", () => {
    const ctx = createMockCtx();
    mockGetDueSchedules.mockReturnValue([
      { id: "s1", label: "Daily research", type: "research", goal: "Check news", threadId: "t1", runtimeState: {} },
    ]);

    const loop = new WorkerLoop(ctx, {
      scheduleCheckIntervalMs: 1000,
      generateInitialBriefing: false,
    });
    loop.start();

    vi.advanceTimersByTime(1000);

    expect(mockMarkScheduleRun).toHaveBeenCalledWith(ctx.storage, "s1");
    expect(ctx.backgroundJobs?.enqueueResearch).toHaveBeenCalledWith({
      goal: "Check news",
      threadId: "t1",
      sourceKind: "schedule",
      sourceScheduleId: "s1",
      budgetMaxSearches: 5,
      budgetMaxPages: 8,
    });

    loop.stop();
  });

  it("creates swarm jobs for analysis schedules", () => {
    const ctx = createMockCtx();
    mockGetDueSchedules.mockReturnValue([
      { id: "s2", label: "Weekly analysis", type: "analysis", goal: "Compare revenue trends", threadId: "t2" },
    ]);

    const loop = new WorkerLoop(ctx, {
      scheduleCheckIntervalMs: 1000,
      generateInitialBriefing: false,
    });
    loop.start();

    vi.advanceTimersByTime(1000);

    expect(mockMarkScheduleRun).toHaveBeenCalledWith(ctx.storage, "s2");
    expect(ctx.backgroundJobs?.enqueueSwarm).toHaveBeenCalledWith({
      goal: "Compare revenue trends",
      threadId: "t2",
      sourceKind: "schedule",
      sourceScheduleId: "s2",
    });

    loop.stop();
  });

  it("runs the automatic Linear issue sweep on interval", () => {
    const ctx = createMockCtx();
    ctx.config.linear = {
      enabled: true,
      autoCreateRecurringIssues: true,
      apiKey: "lin_api_key",
      defaultTeam: "ENG",
    } as any;
    mockSyncAutomaticLinearIssues.mockResolvedValue({
      created: 1,
      updated: 0,
      candidates: 1,
      skipped: 0,
    });

    const loop = new WorkerLoop(ctx, {
      generateInitialBriefing: false,
    });
    loop.start();

    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(mockSyncAutomaticLinearIssues).toHaveBeenCalledWith(ctx.storage, ctx.config, ctx.logger);

    loop.stop();
  });
});

describe("buildEnrichedResearchGoal", () => {
  it("returns plain goal when no previous brief exists", () => {
    const mockStorage = { query: vi.fn().mockReturnValue([]) };
    const result = buildEnrichedResearchGoal(mockStorage, {
      goal: "What's happening in crypto?",
      latestBriefId: null,
    });
    expect(result).toBe("What's happening in crypto?");
    expect(mockStorage.query).not.toHaveBeenCalled();
  });

  it("returns plain goal when latestBriefId is undefined", () => {
    const mockStorage = { query: vi.fn().mockReturnValue([]) };
    const result = buildEnrichedResearchGoal(mockStorage, {
      goal: "Check news",
    });
    expect(result).toBe("Check news");
  });

  it("appends previous summary and date when brief exists", () => {
    const sections = {
      recommendation: { summary: "BTC at $73,800, market cautious" },
      what_changed: [{ title: "ETF inflows declining" }, { title: "Fear index at 18" }],
    };
    const mockStorage = {
      query: vi.fn().mockReturnValue([{ sections: JSON.stringify(sections) }]),
    };

    const result = buildEnrichedResearchGoal(mockStorage, {
      goal: "What's happening in crypto?",
      latestBriefId: "brief-123",
      lastDeliveredAt: "2026-03-12T10:00:00.000Z",
    });

    expect(result).toContain("What's happening in crypto?");
    expect(result).toContain("WHAT WAS ALREADY COVERED");
    expect(result).toContain("BTC at $73,800");
    expect(result).toContain("ETF inflows declining");
    expect(result).toContain("since 2026-03-12");
    expect(result).toContain("FRESH information");
  });

  it("returns plain goal when brief sections cannot be parsed", () => {
    const mockStorage = {
      query: vi.fn().mockReturnValue([{ sections: "not valid json" }]),
    };

    const result = buildEnrichedResearchGoal(mockStorage, {
      goal: "Check news",
      latestBriefId: "brief-bad",
    });
    expect(result).toBe("Check news");
  });

  it("returns plain goal when brief has no recommendation summary", () => {
    const mockStorage = {
      query: vi.fn().mockReturnValue([{ sections: JSON.stringify({ recommendation: {} }) }]),
    };

    const result = buildEnrichedResearchGoal(mockStorage, {
      goal: "Check news",
      latestBriefId: "brief-empty",
    });
    expect(result).toBe("Check news");
  });

  it("omits since clause when lastDeliveredAt is not set", () => {
    const sections = {
      recommendation: { summary: "Market stable" },
    };
    const mockStorage = {
      query: vi.fn().mockReturnValue([{ sections: JSON.stringify(sections) }]),
    };

    const result = buildEnrichedResearchGoal(mockStorage, {
      goal: "Check news",
      latestBriefId: "brief-no-date",
    });

    expect(result).toContain("WHAT WAS ALREADY COVERED");
    expect(result).toContain("Market stable");
    expect(result).not.toContain("since 20");
  });
});
