import { describe, it, expect } from "vitest";
import { formatDateTime, normalizeTimestamp, parseTimestamp } from "../src/timezone.js";

describe("formatDateTime", () => {
  const testDate = new Date("2026-02-28T14:15:00Z");

  it("formats date with default timezone", () => {
    const result = formatDateTime(undefined, testDate);
    expect(result.date).toBeTruthy();
    expect(result.time).toBeTruthy();
    expect(result.full).toContain(result.date);
    expect(result.full).toContain(result.time);
    expect(result.year).toBe(2026);
  });

  it("formats date with explicit timezone", () => {
    const result = formatDateTime("America/New_York", testDate);
    expect(result.date).toContain("2026");
    expect(result.date).toContain("February");
    expect(result.date).toContain("Saturday");
    expect(result.time).toBeTruthy();
    expect(result.year).toBe(2026);
  });

  it("uses current date when none provided", () => {
    const result = formatDateTime();
    expect(result.year).toBeGreaterThanOrEqual(2026);
    expect(result.date).toBeTruthy();
  });
});


describe("timestamp normalization", () => {
  it("normalizes SQLite UTC datetime to ISO-8601 UTC", () => {
    expect(normalizeTimestamp("2026-02-28 14:15:00")).toBe("2026-02-28T14:15:00Z");
    expect(normalizeTimestamp("2026-02-28 14:15:00.123")).toBe("2026-02-28T14:15:00.123Z");
  });

  it("keeps already-normalized timestamps unchanged", () => {
    expect(normalizeTimestamp("2026-02-28T14:15:00Z")).toBe("2026-02-28T14:15:00Z");
    expect(normalizeTimestamp("2026-02-28T14:15:00+02:00")).toBe("2026-02-28T14:15:00+02:00");
  });

  it("parses SQLite UTC timestamps correctly", () => {
    const parsed = parseTimestamp("2026-02-28 14:15:00");
    expect(parsed.toISOString()).toBe("2026-02-28T14:15:00.000Z");
  });
});
