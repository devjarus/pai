import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "@personal-ai/core";
import { swarmMigrations, listSwarmJobs, createSwarmJob, cancelSwarmJob } from "../src/index.js";

describe("plugin-swarm migrations stub", () => {
  it("applies swarm migrations and supports historical job helpers", () => {
    const dir = mkdtempSync(join(tmpdir(), "pai-swarm-"));
    const storage = createStorage(dir);
    storage.migrate("swarm", swarmMigrations);

    const id = createSwarmJob(storage, { goal: "legacy row", threadId: null });
    expect(listSwarmJobs(storage).map((j) => j.id)).toContain(id);
    expect(cancelSwarmJob(storage, id)).toBe(true);
    storage.close();
  });
});
