import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startResearchPushLoop } from "../src/push.js";
import type { Bot } from "grammy";
import type { Storage, Logger } from "@personal-ai/core";

// Mock telegraph module so it doesn't make real HTTP calls
const mockGetOrCreateAccount = vi.fn().mockResolvedValue(null);
const mockUploadImage = vi.fn().mockResolvedValue(null);
const mockCreatePage = vi.fn().mockResolvedValue(null);
vi.mock("../src/telegraph.js", () => ({
  getOrCreateAccount: (...args: unknown[]) => mockGetOrCreateAccount(...args),
  uploadImage: (...args: unknown[]) => mockUploadImage(...args),
  createPage: (...args: unknown[]) => mockCreatePage(...args),
}));

function createMockStorage(rows: Array<{ id: string; sections: string }> = []): Storage {
  return {
    query: vi.fn().mockReturnValue(rows),
    run: vi.fn(),
    migrate: vi.fn(),
    close: vi.fn(),
  } as unknown as Storage;
}

function createMockBot(): Bot {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      sendPhoto: vi.fn().mockResolvedValue({ message_id: 2 }),
      sendMediaGroup: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Bot;
}

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("startResearchPushLoop", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    tempDirs = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("polls on interval and can be stopped", () => {
    const storage = createMockStorage();
    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);

    // Initially no poll yet (setInterval doesn't fire immediately)
    expect(storage.query).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(storage.query).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(storage.query).toHaveBeenCalledTimes(2);

    handle.stop();

    vi.advanceTimersByTime(5000);
    // Should not have polled again after stop
    expect(storage.query).toHaveBeenCalledTimes(2);
  });

  it("sends messages for ready research reports with matching chat", async () => {
    const researchRow = {
      id: "research-job123",
      sections: JSON.stringify({ goal: "AI trends", report: "AI is growing fast" }),
    };
    const storage = createMockStorage([researchRow]);

    // Mock chat ID lookup: research_jobs -> thread -> telegram_threads
    (storage.query as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([researchRow]) // briefings query
      .mockReturnValueOnce([]) // deriveReportVisuals -> listArtifacts
      .mockReturnValueOnce([{ thread_id: "thread-1" }]) // research_jobs query
      .mockReturnValueOnce([{ chat_id: 12345 }]); // telegram_threads query

    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);

    vi.advanceTimersByTime(1000);

    // Allow async to settle
    await vi.advanceTimersByTimeAsync(0);

    // Telegraph returns null (mocked) so falls back to text messages
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Research Complete"),
      { parse_mode: "HTML" },
    );

    // Should mark as sent
    expect(storage.run).toHaveBeenCalledWith(
      "UPDATE briefings SET telegram_sent_at = datetime('now') WHERE id = ?",
      ["research-job123"],
    );

    handle.stop();
  });

  it("sends summary, inline chart photo, and Telegraph button when visuals are present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-push-visuals-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "trend.png");
    writeFileSync(imagePath, Buffer.from("png"));

    const researchRow = {
      id: "research-job-with-visual",
      sections: JSON.stringify({
        goal: "AI revenue trends",
        report: "Revenue is up strongly.",
        execution: "analysis",
        visuals: [
          {
            artifactId: "art-1",
            mimeType: "image/png",
            kind: "chart",
            title: "Trend",
            order: 1,
          },
        ],
      }),
    };
    const storage = createMockStorage([researchRow]);
    (storage.query as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([researchRow]) // briefings query
      .mockReturnValueOnce([{ thread_id: "thread-1" }]) // research_jobs query
      .mockReturnValueOnce([{ chat_id: 12345 }]) // telegram_threads query
      .mockReturnValueOnce([{ id: "art-1", job_id: "job-with-visual", name: "trend.png", mime_type: "image/png", file_path: imagePath, size: 3, created_at: "now" }]) // sendVisuals getArtifact
      .mockReturnValueOnce([{ id: "art-1", job_id: "job-with-visual", name: "trend.png", mime_type: "image/png", file_path: imagePath, size: 3, created_at: "now" }]); // telegraph image getArtifact

    mockGetOrCreateAccount.mockResolvedValue({ access_token: "token" });
    mockUploadImage.mockResolvedValue("https://cdn.example.com/trend.png");
    mockCreatePage.mockResolvedValue({ url: "https://telegra.ph/report" });

    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);
    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      12345,
      expect.stringContaining("Analysis Complete"),
      { parse_mode: "HTML" },
    );
    expect(bot.api.sendPhoto).toHaveBeenCalledOnce();
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      12345,
      "\uD83D\uDCC4 Full report",
      expect.objectContaining({
        reply_markup: expect.anything(),
      }),
    );

    handle.stop();
  });

  it("marks reports as sent even without originating chat", async () => {
    const researchRow = {
      id: "research-nojob",
      sections: JSON.stringify({ goal: "Test", report: "Some report" }),
    };
    const storage = createMockStorage([researchRow]);

    // No matching job (not a research- prefixed ID that matches)
    (storage.query as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([researchRow]) // briefings query
      .mockReturnValueOnce([]); // research_jobs query returns nothing

    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);

    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Should NOT have sent any Telegram message (no chat found)
    expect(bot.api.sendMessage).not.toHaveBeenCalled();

    // Should still mark as sent to avoid re-checking
    expect(storage.run).toHaveBeenCalledWith(
      "UPDATE briefings SET telegram_sent_at = datetime('now') WHERE id = ?",
      ["research-nojob"],
    );

    handle.stop();
  });

  it("skips reports without a report field", async () => {
    const row = {
      id: "research-empty",
      sections: JSON.stringify({ goal: "No report" }),
    };
    const storage = createMockStorage([row]);

    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);

    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(storage.run).not.toHaveBeenCalled();

    handle.stop();
  });

  it("sends messages for swarm reports with matching chat", async () => {
    const swarmRow = {
      id: "swarm-swarmjob456",
      sections: JSON.stringify({ goal: "Market analysis", report: "Markets are up" }),
    };
    const storage = createMockStorage([swarmRow]);

    // Mock chat ID lookup: swarm_jobs -> thread -> telegram_threads
    (storage.query as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([swarmRow]) // briefings query
      .mockReturnValueOnce([]) // deriveReportVisuals -> listArtifacts
      .mockReturnValueOnce([{ thread_id: "thread-2" }]) // swarm_jobs query
      .mockReturnValueOnce([{ chat_id: 67890 }]); // telegram_threads query

    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);

    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Telegraph returns null (mocked) so falls back to text messages
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      67890,
      expect.stringContaining("Analysis Complete"),
      { parse_mode: "HTML" },
    );

    expect(storage.run).toHaveBeenCalledWith(
      "UPDATE briefings SET telegram_sent_at = datetime('now') WHERE id = ?",
      ["swarm-swarmjob456"],
    );

    handle.stop();
  });

  it("marks unknown-prefix briefings as sent without sending", async () => {
    const row = {
      id: "daily-abc123",
      sections: JSON.stringify({ goal: "Daily briefing", report: "Today's summary" }),
    };
    const storage = createMockStorage([row]);

    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);

    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    // No Telegram message — unknown prefix returns null chatId
    expect(bot.api.sendMessage).not.toHaveBeenCalled();

    // Should still mark as sent to avoid re-checking
    expect(storage.run).toHaveBeenCalledWith(
      "UPDATE briefings SET telegram_sent_at = datetime('now') WHERE id = ?",
      ["daily-abc123"],
    );

    handle.stop();
  });

  it("stop() clears the interval", () => {
    const storage = createMockStorage();
    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 500);
    handle.stop();

    vi.advanceTimersByTime(5000);
    expect(storage.query).not.toHaveBeenCalled();
  });
});
