import { describe, it, expect, vi } from "vitest";

vi.mock("@personal-ai/core", () => ({
  memoryMigrations: [{ version: 1, up: "" }],
  threadMigrations: [{ version: 1, up: "" }],
  knowledgeMigrations: [{ version: 1, up: "" }],
  authMigrations: [{ version: 1, up: "" }],
  backgroundJobMigrations: [{ version: 1, up: "" }],
  artifactMigrations: [{ version: 1, up: "" }],
  telemetryMigrations: [{ version: 1, up: "" }],
  productEventMigrations: [{ version: 1, up: "" }],
}));
vi.mock("@personal-ai/plugin-tasks", () => ({ taskMigrations: [{ version: 1, up: "" }] }));
vi.mock("@personal-ai/plugin-telegram", () => ({ telegramMigrations: [{ version: 1, up: "" }] }));
vi.mock("@personal-ai/plugin-research", () => ({ researchMigrations: [{ version: 1, up: "" }] }));
vi.mock("@personal-ai/plugin-swarm", () => ({ swarmMigrations: [{ version: 1, up: "" }] }));
vi.mock("@personal-ai/plugin-schedules", () => ({ scheduleMigrations: [{ version: 1, up: "" }] }));
vi.mock("../src/briefing.js", () => ({ briefingMigrations: [{ version: 1, up: "" }] }));
vi.mock("../src/learning.js", () => ({ learningMigrations: [{ version: 1, up: "" }] }));
vi.mock("../src/digest-ratings.js", () => ({ digestRatingsMigrations: [{ version: 1, up: "" }] }));

import { allMigrations, runAllMigrations } from "../src/migrations.js";

describe("allMigrations", () => {
  it("is an array of [string, Migration[]] tuples", () => {
    expect(Array.isArray(allMigrations)).toBe(true);
    for (const entry of allMigrations) {
      expect(Array.isArray(entry)).toBe(true);
      expect(entry).toHaveLength(2);
      const [name, migrations] = entry;
      expect(typeof name).toBe("string");
      expect(Array.isArray(migrations)).toBe(true);
    }
  });

  it("has all expected plugin names", () => {
    const names = allMigrations.map(([name]) => name);
    expect(names).toContain("memory");
    expect(names).toContain("tasks");
    expect(names).toContain("threads");
    expect(names).toContain("knowledge");
    expect(names).toContain("auth");
    expect(names).toContain("background_jobs");
    expect(names).toContain("artifacts");
    expect(names).toContain("telemetry");
    expect(names).toContain("product_events");
    expect(names).toContain("telegram");
    expect(names).toContain("research");
    expect(names).toContain("swarm");
    expect(names).toContain("schedules");
    expect(names).toContain("inbox");
    expect(names).toContain("learning");
    expect(names).toContain("findings");
    expect(names).toContain("digest_ratings");
    expect(names).toContain("topic_insights");
  });

  it("has 18 entries total", () => {
    expect(allMigrations).toHaveLength(18);
  });
});

describe("runAllMigrations", () => {
  it("calls storage.migrate for each entry in allMigrations", () => {
    const mockStorage = { migrate: vi.fn() };

    runAllMigrations(mockStorage as never);

    expect(mockStorage.migrate).toHaveBeenCalledTimes(allMigrations.length);
    for (const [name, migrations] of allMigrations) {
      expect(mockStorage.migrate).toHaveBeenCalledWith(name, migrations);
    }
  });

  it("calls storage.migrate in the order defined by allMigrations", () => {
    const mockStorage = { migrate: vi.fn() };
    const callOrder: string[] = [];
    mockStorage.migrate.mockImplementation((name: string) => {
      callOrder.push(name);
    });

    runAllMigrations(mockStorage as never);

    const expectedOrder = allMigrations.map(([name]) => name);
    expect(callOrder).toEqual(expectedOrder);
  });
});
