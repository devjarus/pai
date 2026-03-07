import { describe, expect, it } from "vitest";
import {
  buildAreaPath,
  buildDonutSegments,
  buildLinePath,
  buildLinePoints,
  formatChartValue,
  getChartBounds,
} from "../src/lib/chart-utils";

describe("getChartBounds", () => {
  it("pads flat series to avoid zero range", () => {
    const bounds = getChartBounds([5, 5, 5]);
    expect(bounds.min).toBeLessThan(5);
    expect(bounds.max).toBeGreaterThan(5);
    expect(bounds.range).toBeGreaterThan(0);
  });
});

describe("buildLinePoints", () => {
  it("creates chart points inside the padded chart area", () => {
    const points = buildLinePoints([10, 20, 15], 300, 180, 20);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 20, y: 160 });
    expect(points[1].x).toBe(150);
    expect(points[1].y).toBe(20);
    expect(points[2].x).toBe(280);
  });
});

describe("buildLinePath and buildAreaPath", () => {
  it("builds deterministic SVG path strings", () => {
    const points = [
      { x: 20, y: 160 },
      { x: 150, y: 20 },
      { x: 280, y: 90 },
    ];
    expect(buildLinePath(points)).toBe("M 20 160 L 150 20 L 280 90");
    expect(buildAreaPath(points, 180, 20)).toBe("M 20 160 L 150 20 L 280 90 L 280 160 L 20 160 Z");
  });
});

describe("buildDonutSegments", () => {
  it("computes segment percentages and offsets", () => {
    const segments = buildDonutSegments(
      [
        { label: "BTC", value: 60 },
        { label: "ETH", value: 40 },
      ],
      100,
    );

    expect(segments[0]).toMatchObject({
      label: "BTC",
      percentage: 0.6,
      dashLength: 60,
    });
    expect(Math.abs(segments[0].dashOffset)).toBe(0);
    expect(segments[1]).toMatchObject({
      label: "ETH",
      percentage: 0.4,
      dashLength: 40,
      dashOffset: -60,
    });
  });
});

describe("formatChartValue", () => {
  it("formats compact chart labels with prefixes and suffixes", () => {
    expect(formatChartValue(97150.3, "$", null)).toBe("$97.2K");
    expect(formatChartValue(28.4, null, "%")).toBe("28.40%");
    expect(formatChartValue(3_200_000_000, "$", null)).toBe("$3.2B");
  });
});
