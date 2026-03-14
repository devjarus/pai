import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { Logger, Storage } from "@personal-ai/core";

import { buildTelegramReportDocument, sendReportDocumentToTelegram, _buildReportHtml } from "../src/report-document.js";

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

describe("report HTML generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates HTML with report header and markdown body", () => {
    const logger = createLogger();
    const storage = {} as Storage;

    const html = _buildReportHtml(storage, {
      title: "AI Revenue Trends",
      markdown: "# Summary\n\nRevenue is **up**.",
    }, logger);

    expect(html).toContain("AI Revenue Trends");
    expect(html).toContain("Delivered privately by Personal AI");
    expect(html).toContain("<strong>up</strong>");
    expect(html).toContain("<h1");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("renders json-render spec as rich HTML", () => {
    const logger = createLogger();
    const storage = {} as Storage;
    const renderSpec = {
      root: "root",
      elements: {
        root: {
          type: "Section",
          props: { title: "Key Metrics" },
          children: ["card1"],
        },
        card1: {
          type: "MetricCard",
          props: { label: "Revenue", value: "$42M", trend: "up" },
          children: [],
        },
      },
    };

    const html = _buildReportHtml(storage, {
      title: "Report",
      markdown: "Body text.",
      renderSpec,
    }, logger);

    expect(html).toContain("Key Metrics");
    expect(html).toContain("$42M");
    expect(html).toContain("Revenue");
    expect(html).toContain("spec-section");
  });

  it("embeds visuals as data URIs", () => {
    const logger = createLogger();
    const storage = {} as Storage;
    mockGetArtifact.mockReturnValueOnce({
      id: "art-1",
      name: "trend.png",
      mimeType: "image/png",
      data: TINY_PNG,
    });

    const html = _buildReportHtml(storage, {
      title: "Charts",
      markdown: "See below.",
      visuals: [{ artifactId: "art-1", title: "Trend Chart", caption: "Quarterly growth", order: 1 }],
    }, logger);

    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("Quarterly growth");
    expect(html).toContain("visual-card");
  });

  it("strips jsonrender blocks from markdown", () => {
    const logger = createLogger();
    const storage = {} as Storage;

    const html = _buildReportHtml(storage, {
      title: "Report",
      markdown: "Intro\n\n```jsonrender\n{\"root\":\"x\"}\n```\n\nConclusion.",
    }, logger);

    expect(html).not.toContain("jsonrender");
    expect(html).toContain("Intro");
    expect(html).toContain("Conclusion");
  });

  it("handles emojis in title and markdown without crashing", () => {
    const logger = createLogger();
    const storage = {} as Storage;

    const html = _buildReportHtml(storage, {
      title: "📊 Live Prices",
      markdown: "## 📈 Market\n\nBitcoin is up.\n\n## 🔑 Drivers\n\n- ETF inflows continue",
    }, logger);

    expect(html).toContain("📊 Live Prices");
    expect(html).toContain("📈 Market");
  });
});

describe("report document PDF delivery", { timeout: 30_000 }, () => {
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

  it("includes rich spec content in the generated PDF", async () => {
    const logger = createLogger();
    const storage = {} as Storage;

    const renderSpec = {
      root: "root",
      elements: {
        root: {
          type: "MetricCard",
          props: { label: "Price", value: "$100", trend: "up" },
          children: [],
        },
      },
    };

    const document = await buildTelegramReportDocument(
      storage,
      {
        title: "Rich Report",
        markdown: "Analysis below.",
        renderSpec,
      },
      logger,
    );

    expect(document.data.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    expect(document.data.length).toBeGreaterThan(1500);
  });
});
