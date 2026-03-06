import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Bot } from "grammy";
import type { Logger, Storage } from "@personal-ai/core";
import { sendArtifactsToTelegram, sendVisualsToTelegram } from "../src/delivery.js";

const mockGetArtifact = vi.fn();

vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    getArtifact: (...args: unknown[]) => mockGetArtifact(...args),
  };
});

function createBot(): Bot {
  return {
    api: {
      sendPhoto: vi.fn().mockResolvedValue({}),
      sendMediaGroup: vi.fn().mockResolvedValue([]),
      sendDocument: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Bot;
}

function createLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as Logger;
}

describe("Telegram delivery helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends multiple visuals as a media group", async () => {
    const bot = createBot();
    const logger = createLogger();
    mockGetArtifact
      .mockReturnValueOnce({ id: "art-1", name: "chart-1.png", mimeType: "image/png", data: Buffer.from("1") })
      .mockReturnValueOnce({ id: "art-2", name: "chart-2.png", mimeType: "image/png", data: Buffer.from("2") });

    await sendVisualsToTelegram(
      {} as Storage,
      bot,
      123,
      [
        { artifactId: "art-1", mimeType: "image/png", kind: "chart", title: "First", order: 1 },
        { artifactId: "art-2", mimeType: "image/png", kind: "chart", title: "Second", order: 2 },
      ],
      logger,
    );

    expect(bot.api.sendMediaGroup).toHaveBeenCalledOnce();
    expect(bot.api.sendPhoto).not.toHaveBeenCalled();
  });

  it("sends image artifacts as photos and non-image artifacts as documents", async () => {
    const bot = createBot();
    const logger = createLogger();
    mockGetArtifact
      .mockReturnValueOnce({ id: "art-1", name: "chart.png", mimeType: "image/png", data: Buffer.from("png") })
      .mockReturnValueOnce({ id: "art-2", name: "report.csv", mimeType: "text/csv", data: Buffer.from("csv") });

    await sendArtifactsToTelegram(
      {} as Storage,
      bot,
      123,
      [
        { id: "art-1", name: "chart.png" },
        { id: "art-2", name: "report.csv" },
      ],
      logger,
    );

    expect(bot.api.sendPhoto).toHaveBeenCalledOnce();
    expect(bot.api.sendDocument).toHaveBeenCalledOnce();
  });
});
