import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerLoop } from "../src/workers.js";
import type { PluginContext } from "@personal-ai/core";

// ---------------------------------------------------------------------------
// Mock all external dependencies so we test WorkerLoop in isolation
// ---------------------------------------------------------------------------
const mockGenerateBriefing = vi.fn().mockResolvedValue(undefined);
const mockGetLatestBriefing = vi.fn().mockReturnValue(null);
vi.mock("../src/briefing.js", () => ({
  generateBriefing: (...args: unknown[]) => mockGenerateBriefing(...args),
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

vi.mock("@personal-ai/plugin-assistant/web-search", () => ({
  webSearch: vi.fn(),
  formatSearchResults: vi.fn(),
}));

vi.mock("@personal-ai/plugin-assistant/page-fetch", () => ({
  fetchPageAsMarkdown: vi.fn(),
}));

function createMockCtx(): PluginContext {
  return {
    config: { dataDir: "/tmp", llm: {}, plugins: [], logLevel: "silent" },
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
  } as unknown as PluginContext;
}

describe("WorkerLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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

  it("generates initial briefing when none exists", () => {
    const ctx = createMockCtx();
    mockGetLatestBriefing.mockReturnValue(null);

    const loop = new WorkerLoop(ctx, { generateInitialBriefing: true });
    loop.start();

    expect(mockGetLatestBriefing).toHaveBeenCalled();
    expect(mockGenerateBriefing).toHaveBeenCalledTimes(1);

    loop.stop();
  });

  it("skips initial briefing when one already exists", () => {
    const ctx = createMockCtx();
    mockGetLatestBriefing.mockReturnValue({ id: "existing" });

    const loop = new WorkerLoop(ctx, { generateInitialBriefing: true });
    loop.start();

    expect(mockGetLatestBriefing).toHaveBeenCalled();
    expect(mockGenerateBriefing).not.toHaveBeenCalled();

    loop.stop();
  });

  it("runs briefing on interval", () => {
    const ctx = createMockCtx();
    mockGetLatestBriefing.mockReturnValue({ id: "existing" }); // skip initial

    const loop = new WorkerLoop(ctx, { briefingIntervalMs: 5000, generateInitialBriefing: true });
    loop.start();

    expect(mockGenerateBriefing).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(mockGenerateBriefing).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(mockGenerateBriefing).toHaveBeenCalledTimes(2);

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
      { id: "s1", label: "Daily research", type: "research", goal: "Check news", threadId: "t1" },
    ]);

    const loop = new WorkerLoop(ctx, {
      scheduleCheckIntervalMs: 1000,
      generateInitialBriefing: false,
    });
    loop.start();

    vi.advanceTimersByTime(1000);

    expect(mockMarkScheduleRun).toHaveBeenCalledWith(ctx.storage, "s1");
    expect(mockCreateResearchJob).toHaveBeenCalledWith(ctx.storage, {
      goal: "Check news",
      threadId: "t1",
    });
    expect(mockRunResearchInBackground).toHaveBeenCalledTimes(1);

    loop.stop();
  });
});
