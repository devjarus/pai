import { describe, it, expect } from "vitest";
import { listTemplates, getTemplate, applyTemplate } from "../src/templates.js";

describe("watch templates", () => {
  it("lists all templates", () => {
    const all = listTemplates();
    expect(all).toHaveLength(5);
    const ids = all.map((t) => t.id);
    expect(ids).toContain("price-watch");
    expect(ids).toContain("news-watch");
    expect(ids).toContain("competitor-watch");
    expect(ids).toContain("availability-watch");
    expect(ids).toContain("general-watch");
  });

  it("gets a template by id", () => {
    const tpl = getTemplate("news-watch");
    expect(tpl).toBeDefined();
    expect(tpl!.name).toBe("News Watch");
    expect(tpl!.category).toBe("news");
  });

  it("returns undefined for unknown id", () => {
    expect(getTemplate("does-not-exist")).toBeUndefined();
  });

  it("applies a template with a subject", () => {
    const result = applyTemplate("price-watch", { subject: "Bitcoin" });
    expect(result).toBeDefined();
    expect(result!.goal).toContain("Bitcoin");
    expect(result!.intervalHours).toBe(6);
    expect(result!.deliveryMode).toBe("change-gated");
    expect(result!.depthLevel).toBe("quick");
    expect(result!.label).toBe("Price Watch: Bitcoin");
  });

  it("applyTemplate returns undefined for unknown template", () => {
    expect(applyTemplate("nope", { subject: "x" })).toBeUndefined();
  });
});
