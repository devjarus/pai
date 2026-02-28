import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startResearchPushLoop } from "../src/push.js";
import type { Bot } from "grammy";
import type { Storage, Logger } from "@personal-ai/core";

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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
      .mockReturnValueOnce([{ thread_id: "thread-1" }]) // research_jobs query
      .mockReturnValueOnce([{ chat_id: 12345 }]); // telegram_threads query

    const bot = createMockBot();
    const logger = createMockLogger();

    const handle = startResearchPushLoop(storage, bot, logger, 1000);

    vi.advanceTimersByTime(1000);

    // Allow async to settle
    await vi.advanceTimersByTimeAsync(0);

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
