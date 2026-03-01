import { describe, it, expect } from "vitest";
import { formatDateTime } from "../src/timezone.js";

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
