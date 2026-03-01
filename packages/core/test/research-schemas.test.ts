import { describe, it, expect } from "vitest";
import { detectResearchDomain } from "../src/research-schemas.js";

describe("detectResearchDomain", () => {
  describe("flight detection", () => {
    it("detects 'flights' keyword", () => {
      expect(detectResearchDomain("Find me flights from SFO to Tokyo")).toBe("flight");
    });

    it("detects 'airfare' keyword", () => {
      expect(detectResearchDomain("Compare airfare to London")).toBe("flight");
    });

    it("detects 'fly from/to' pattern", () => {
      expect(detectResearchDomain("I want to fly from NYC to LA")).toBe("flight");
    });

    it("detects airport code pattern", () => {
      expect(detectResearchDomain("SFO to NRT March 2026")).toBe("flight");
    });

    it("detects 'round trip' keyword", () => {
      expect(detectResearchDomain("round trip to Paris in summer")).toBe("flight");
    });

    it("detects booking + flight", () => {
      expect(detectResearchDomain("booking a flight to Berlin")).toBe("flight");
    });

    it("does not false-positive on 'travel' without flight keywords", () => {
      // Ambiguous: could be driving, train, etc. LLM can specify type="flight" if needed.
      expect(detectResearchDomain("travel from Chicago to Miami for spring break")).toBe("general");
    });

    it("detects airline keyword", () => {
      expect(detectResearchDomain("airline tickets to Hawaii")).toBe("flight");
    });
  });

  describe("stock detection", () => {
    it("detects 'stock' keyword", () => {
      expect(detectResearchDomain("Analyze NVIDIA stock")).toBe("stock");
    });

    it("detects 'shares' keyword", () => {
      expect(detectResearchDomain("Should I buy shares of Apple")).toBe("stock");
    });

    it("does not false-positive on 'investment' without stock keywords", () => {
      // Ambiguous: could be real estate, crypto, etc. LLM can specify type="stock" if needed.
      expect(detectResearchDomain("Good investment opportunities in tech")).toBe("general");
    });

    it("detects well-known ticker symbols", () => {
      expect(detectResearchDomain("Analyze NVDA performance")).toBe("stock");
      expect(detectResearchDomain("Is AAPL a good buy")).toBe("stock");
      expect(detectResearchDomain("TSLA earnings report")).toBe("stock");
    });

    it("detects analysis + ticker pattern", () => {
      expect(detectResearchDomain("Research MSFT stock performance")).toBe("stock");
    });

    it("detects buy/sell + stock pattern", () => {
      expect(detectResearchDomain("Should I sell my stock position")).toBe("stock");
    });

    it("detects P/E and valuation keywords", () => {
      expect(detectResearchDomain("GOOGL P/E ratio and valuation analysis")).toBe("stock");
    });

    it("detects ticker keyword", () => {
      expect(detectResearchDomain("What's the ticker for Nvidia")).toBe("stock");
    });
  });

  describe("general detection", () => {
    it("returns general for non-specific topics", () => {
      expect(detectResearchDomain("Research the history of the internet")).toBe("general");
    });

    it("returns general for ambiguous queries", () => {
      expect(detectResearchDomain("What's new in AI this year")).toBe("general");
    });

    it("returns general for product research", () => {
      expect(detectResearchDomain("Best laptops for programming 2026")).toBe("general");
    });

    it("returns general for cooking topics", () => {
      expect(detectResearchDomain("Research Italian pasta recipes")).toBe("general");
    });

    it("returns general for academic topics", () => {
      expect(detectResearchDomain("Latest research on quantum computing")).toBe("general");
    });

    it("detects news for breaking news research (regression: was false-positive flight)", () => {
      expect(detectResearchDomain(
        "Research and compile a brief summary of the latest breaking news from around the world. Cover major headlines in politics, technology, finance, and world events. Keep it concise and to the point."
      )).toBe("news");
    });
  });

  describe("crypto detection", () => {
    it("detects 'cryptocurrency' keyword", () => {
      expect(detectResearchDomain("Research the latest cryptocurrency trends")).toBe("crypto");
    });

    it("detects 'bitcoin' keyword", () => {
      expect(detectResearchDomain("What is the current bitcoin price outlook")).toBe("crypto");
    });

    it("detects crypto tickers", () => {
      expect(detectResearchDomain("Analyze SOL price action")).toBe("crypto");
    });
  });

  describe("news detection", () => {
    it("detects 'news' keyword", () => {
      expect(detectResearchDomain("Get me the latest AI news")).toBe("news");
    });

    it("detects 'headlines' keyword", () => {
      expect(detectResearchDomain("Show today's tech headlines")).toBe("news");
    });
  });

  describe("comparison detection", () => {
    it("detects 'compare' keyword", () => {
      expect(detectResearchDomain("Compare React and Vue for web development")).toBe("comparison");
    });

    it("detects 'vs' keyword", () => {
      expect(detectResearchDomain("Python vs JavaScript for backend development")).toBe("comparison");
    });
  });
});
