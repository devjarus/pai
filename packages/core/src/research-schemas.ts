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

export type ResearchResultType = "flight" | "stock" | "crypto" | "news" | "comparison" | "general";

export type ResearchResult =
  | { type: "flight"; data: FlightReport }
  | { type: "stock"; data: StockReport }
  | { type: "crypto"; data: { markdown: string; structured?: unknown } }
  | { type: "news"; data: { markdown: string; structured?: unknown } }
  | { type: "comparison"; data: { markdown: string; structured?: unknown } }
  | { type: "general"; data: { markdown: string } };

/**
 * Detect research domain from the goal text.
 * Returns the domain type and a cleaned goal.
 */
export function detectResearchDomain(goal: string): ResearchResultType {
  const lower = goal.toLowerCase();

  // Flight: only match unambiguous flight-related keywords
  if (/\bflights?\b/.test(lower)) return "flight";
  if (/\bairfares?\b/.test(lower)) return "flight";
  if (/\bairline/.test(lower)) return "flight";
  if (/\bfly\s+(from|to)\b/.test(lower)) return "flight";
  if (/\bround[\s-]?trip\b/.test(lower)) return "flight";
  // Airport codes: UPPERCASE only (e.g. "JFK to LAX") — no /i flag
  if (/\b[A-Z]{3}\s*(to|→|->)\s*[A-Z]{3}\b/.test(goal)) return "flight";

  // Stock: only match unambiguous stock/investment keywords
  if (/\bstock\b/.test(lower)) return "stock";
  if (/\bshares?\b/.test(lower)) return "stock";
  if (/\bticker\b/.test(lower)) return "stock";
  if (/\bequity\b/.test(lower)) return "stock";
  // Well-known stock tickers (uppercase only, tested against original goal)
  if (/\b(NVDA|AAPL|GOOGL|MSFT|TSLA|AMZN|META|AMD|INTC|NFLX)\b/.test(goal)) return "stock";

  // Crypto: match cryptocurrency keywords and well-known tickers
  if (/\bcrypto(?:currency)?\b/.test(lower)) return "crypto";
  if (/\bbitcoin\b/.test(lower)) return "crypto";
  if (/\bethereum\b/.test(lower)) return "crypto";
  if (/\bdefi\b/.test(lower)) return "crypto";
  if (/\btoken\b/.test(lower) && /\bprice\b/.test(lower)) return "crypto";
  if (/\b(BTC|ETH|SOL|ADA|DOT|DOGE|XRP)\b/.test(goal)) return "crypto";

  // News: match news/current events keywords
  if (/\bnews\b/.test(lower)) return "news";
  if (/\bheadlines?\b/.test(lower)) return "news";
  if (/\bcurrent events?\b/.test(lower)) return "news";
  if (/\bbreaking\b/.test(lower)) return "news";

  // Comparison: match comparison keywords
  if (/\bcompar(e|ison|ing)\b/.test(lower)) return "comparison";
  if (/\bvs\.?\b/.test(lower)) return "comparison";
  if (/\bversus\b/.test(lower)) return "comparison";
  if (/\bhead[\s-]to[\s-]head\b/.test(lower)) return "comparison";

  // Default: let the LLM specify type via the tool's optional `type` parameter
  return "general";
}
