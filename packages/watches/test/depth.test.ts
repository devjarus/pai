import { describe, it, expect } from "vitest";
import { getDepthConfig, resolveDepthForWatch } from "../src/depth.js";

describe("depth config", () => {
  it("returns correct budgets for quick", () => {
    const cfg = getDepthConfig("quick");
    expect(cfg.level).toBe("quick");
    expect(cfg.maxAgents).toBe(1);
    expect(cfg.maxSources).toBe(3);
    expect(cfg.budgetMaxSearches).toBe(2);
    expect(cfg.budgetMaxPages).toBe(3);
  });

  it("returns correct budgets for standard", () => {
    const cfg = getDepthConfig("standard");
    expect(cfg.maxAgents).toBe(3);
    expect(cfg.maxSources).toBe(8);
    expect(cfg.budgetMaxSearches).toBe(5);
    expect(cfg.budgetMaxPages).toBe(8);
  });

  it("returns correct budgets for deep", () => {
    const cfg = getDepthConfig("deep");
    expect(cfg.maxAgents).toBe(5);
    expect(cfg.maxSources).toBe(15);
    expect(cfg.budgetMaxSearches).toBe(10);
    expect(cfg.budgetMaxPages).toBe(15);
  });
});

describe("resolveDepthForWatch", () => {
  it("uses the watch depthLevel when set", () => {
    const cfg = resolveDepthForWatch({ depthLevel: "deep" }, false);
    expect(cfg.level).toBe("deep");
  });

  it("defaults to standard when no depthLevel is set", () => {
    const cfg = resolveDepthForWatch({}, false);
    expect(cfg.level).toBe("standard");
  });

  it("bumps quick to standard on manual trigger", () => {
    const cfg = resolveDepthForWatch({ depthLevel: "quick" }, true);
    expect(cfg.level).toBe("standard");
  });

  it("keeps standard on manual trigger (no bump needed)", () => {
    const cfg = resolveDepthForWatch({ depthLevel: "standard" }, true);
    expect(cfg.level).toBe("standard");
  });

  it("keeps deep on manual trigger", () => {
    const cfg = resolveDepthForWatch({ depthLevel: "deep" }, true);
    expect(cfg.level).toBe("deep");
  });
});
