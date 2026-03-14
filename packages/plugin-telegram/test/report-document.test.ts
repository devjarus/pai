import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { Logger, Storage } from "@personal-ai/core";

import { buildTelegramReportDocument, sendReportDocumentToTelegram } from "../src/report-document.js";

const mockGetArtifact = vi.fn();

vi.mock("@personal-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@personal-ai/core")>();
  return {
    ...actual,
    getArtifact: (...args: unknown[]) => mockGetArtifact(...args),
  };
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Ww0YAAAAASUVORK5CYII=",
  "base64",
);

function createLogger(): Logger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as Logger;
}

function createBot(): Bot {
  return {
    api: {
      sendDocument: vi.fn().mockResolvedValue({}),
    },
  } as unknown as Bot;
}

describe("report document delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a PDF report document with a stable file name", async () => {
    const logger = createLogger();
    const storage = {} as Storage;
    mockGetArtifact.mockReturnValueOnce({
      id: "art-1",
      name: "trend.png",
      mimeType: "image/png",
      data: TINY_PNG,
    });

    const document = await buildTelegramReportDocument(
      storage,
      {
        title: "AI Revenue Trends <Q1>",
        markdown: "# Summary\n\nRevenue is **up**.",
        fileName: "analysis.md",
        visuals: [{ artifactId: "art-1", title: "Trend", caption: "Quarterly growth", order: 1 }],
      },
      logger,
    );

    expect(document.fileName).toBe("analysis.pdf");
    expect(document.data.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    expect(mockGetArtifact).toHaveBeenCalledWith(storage, "art-1");
  });

  it("produces a valid PDF when title and body contain emojis", async () => {
    const logger = createLogger();
    const storage = {} as Storage;

    const document = await buildTelegramReportDocument(
      storage,
      {
        title: "📊 Live Prices",
        markdown:
          "## 📈 Market Summary\n\nBitcoin (BTC)\n\nCurrent Range: $72,500 – $73,500\n\n" +
          "## 🔑 Key Market Drivers\n\n- Regulatory clarity improves\n- ETF inflows continue",
      },
      logger,
    );

    expect(document.data.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    // PDF should be non-trivial — prior bug caused blank pages when emojis
    // crashed PDFKit mid-render (content truncation)
    expect(document.data.length).toBeGreaterThan(1500);
  });

  it("sends report documents to Telegram as protected PDF attachments", async () => {
    const logger = createLogger();
    const bot = createBot();

    await sendReportDocumentToTelegram(
      {} as Storage,
      bot,
      12345,
      {
        title: "Quarterly Report",
        markdown: "Body",
      },
      logger,
    );

    expect(bot.api.sendDocument).toHaveBeenCalledWith(
      12345,
      expect.anything(),
      {
        caption: "Quarterly Report",
        parse_mode: "HTML",
        protect_content: true,
      },
    );
  });
});
