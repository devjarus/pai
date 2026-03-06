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

  it("builds a self-contained HTML report document with inlined visuals", () => {
    const logger = createLogger();
    mockGetArtifact.mockReturnValueOnce({
      id: "art-1",
      name: "trend.png",
      mimeType: "image/png",
      data: Buffer.from("png-data"),
    });

    const document = buildTelegramReportDocument(
      {} as Storage,
      {
        title: "AI Revenue Trends <Q1>",
        markdown: "# Summary\n\nRevenue is **up**.",
        fileName: "analysis.md",
        visuals: [{ artifactId: "art-1", title: "Trend", caption: "Quarterly growth", order: 1 }],
      },
      logger,
    );

    const html = document.data.toString("utf-8");
    expect(document.fileName).toBe("analysis.html");
    expect(html).toContain("<title>AI Revenue Trends &lt;Q1&gt;</title>");
    expect(html).toContain("Delivered privately by Personal AI via Telegram.");
    expect(html).toContain("<strong>up</strong>");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("<strong>Trend</strong> - Quarterly growth");
  });

  it("sends report documents as protected Telegram files", async () => {
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
        protect_content: true,
      },
    );
  });
});
