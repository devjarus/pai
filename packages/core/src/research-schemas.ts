/**
 * Typed result schemas for domain-specific research.
 * Used by research plugin to produce structured results, and by UI to render rich cards.
 */

// ---- Flight Research ----

export interface FlightQuery {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  passengers: number;
  maxPrice?: number;
  nonstopOnly?: boolean;
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

export interface FlightOption {
  airline: string;
  flightNo: string;
  departure: string;
  arrival: string;
  duration: string;
  stops: number;
  price: number;
  currency: string;
  returnDeparture?: string;
  returnArrival?: string;
  returnDuration?: string;
  returnStops?: number;
  baggage?: string;
  refundable?: boolean;
  bookingUrl?: string;
  score: number;
  scoreReason: string;
}

export interface FlightReport {
  query: FlightQuery;
  options: FlightOption[];
  searchedAt: string;
  sources: string[];
  disclaimer: string;
}

// ---- Stock Research ----

export interface StockMetrics {
  ticker: string;
  company: string;
  price: number;
  currency: string;
  pe?: number;
  marketCap?: string;
  high52w?: number;
  low52w?: number;
  ytdReturn?: string;
  revGrowth?: string;
  epsActual?: number;
  epsBeat?: string;
  volume?: string;
  avgVolume?: string;
}

export interface ChartArtifact {
  id: string;
  type: "price" | "volume" | "comparison" | "custom";
  title: string;
  description?: string;
  /** SVG string or data URL (base64 PNG) */
  data?: string;
  /** Artifact ID referencing /api/artifacts/:id */
  artifactId?: string;
}

export interface StockReport {
  ticker: string;
  company: string;
  thesis: string;
  confidence: number;
  verdict: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  metrics: StockMetrics;
  risks: string[];
  catalysts: string[];
  sources: Array<{ title: string; url: string }>;
  charts: ChartArtifact[];
  analyzedAt: string;
}

// ---- Union type for all research results ----

export type ResearchResultType = "flight" | "stock" | "general";

export type ResearchResult =
  | { type: "flight"; data: FlightReport }
  | { type: "stock"; data: StockReport }
  | { type: "general"; data: { markdown: string } };

/**
 * Detect research domain from the goal text.
 * Returns the domain type and a cleaned goal.
 */
export function detectResearchDomain(goal: string): ResearchResultType {
  const lower = goal.toLowerCase();

  // Flight patterns
  const flightPatterns = [
    /\bflights?\b/,
    /\bairfare\b/,
    /\bairline/,
    /\bfly\s+(from|to)\b/,
    /\b[A-Z]{3}\s*(to|→|->)\s*[A-Z]{3}\b/i,
    /\bround[\s-]?trip\b/,
    /\bbooking\b.*\b(flight|travel)\b/,
    /\btravel\b.*\b(from|to)\b.*\b(for|on|in)\b/,
  ];

  for (const pattern of flightPatterns) {
    if (pattern.test(lower) || pattern.test(goal)) return "flight";
  }

  // Stock patterns
  const stockPatterns = [
    /\bstock\b/,
    /\bshares?\b/,
    /\bticker\b/,
    /\bequity\b/,
    /\binvest(ing|ment)?\b/,
    /\b(buy|sell)\b.*\b(stock|share|position)\b/,
    /\b[A-Z]{1,5}\b.*\b(price|valuation|analysis|earnings|P\/E|market\s*cap)\b/i,
    /\b(analyze|analysis|research)\b.*\b[A-Z]{1,5}\b.*\b(stock|company|share)\b/i,
    /\b(NVDA|AAPL|GOOGL|MSFT|TSLA|AMZN|META|AMD|INTC|NFLX)\b/,
  ];

  for (const pattern of stockPatterns) {
    if (pattern.test(lower) || pattern.test(goal)) return "stock";
  }

  return "general";
}
