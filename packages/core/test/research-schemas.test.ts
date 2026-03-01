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

    it("detects travel pattern with dates", () => {
      expect(detectResearchDomain("travel from Chicago to Miami for spring break")).toBe("flight");
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

    it("detects investment keyword", () => {
      expect(detectResearchDomain("Good investment opportunities in tech")).toBe("stock");
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
  });
});
