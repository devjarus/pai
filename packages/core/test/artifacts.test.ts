import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "../src/storage.js";
import type { Storage } from "../src/types.js";
import { artifactMigrations, storeArtifact, getArtifact, listArtifacts, deleteJobArtifacts, guessMimeType } from "../src/artifacts.js";

describe("artifacts", () => {
  let storage: Storage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pai-test-"));
    storage = createStorage(join(tmpDir, "test.db"));
    storage.migrate("artifacts", artifactMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores and retrieves an artifact", () => {
    const data = Buffer.from("hello world");
    const id = storeArtifact(storage, {
      jobId: "job-1",
      name: "test.txt",
      mimeType: "text/plain",
      data,
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe("string");

    const artifact = getArtifact(storage, id);
    expect(artifact).not.toBeNull();
    expect(artifact!.name).toBe("test.txt");
    expect(artifact!.mimeType).toBe("text/plain");
    expect(artifact!.jobId).toBe("job-1");
    expect(artifact!.data.toString()).toBe("hello world");
  });

  it("returns null for non-existent artifact", () => {
    expect(getArtifact(storage, "nonexistent")).toBeNull();
  });

  it("lists artifacts for a job", () => {
    storeArtifact(storage, { jobId: "job-1", name: "a.png", mimeType: "image/png", data: Buffer.from("a") });
    storeArtifact(storage, { jobId: "job-1", name: "b.png", mimeType: "image/png", data: Buffer.from("b") });
    storeArtifact(storage, { jobId: "job-2", name: "c.png", mimeType: "image/png", data: Buffer.from("c") });

    const list = listArtifacts(storage, "job-1");
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe("a.png");
    expect(list[0]!.size).toBeGreaterThan(0);
  });

  it("returns empty list for job with no artifacts", () => {
    expect(listArtifacts(storage, "no-such-job")).toHaveLength(0);
  });

  it("deletes artifacts for a job", () => {
    storeArtifact(storage, { jobId: "job-1", name: "a.png", mimeType: "image/png", data: Buffer.from("a") });
    storeArtifact(storage, { jobId: "job-1", name: "b.png", mimeType: "image/png", data: Buffer.from("b") });

    const deleted = deleteJobArtifacts(storage, "job-1");
    expect(deleted).toBe(2);
    expect(listArtifacts(storage, "job-1")).toHaveLength(0);
  });

  it("returns 0 when deleting artifacts for empty job", () => {
    expect(deleteJobArtifacts(storage, "no-such-job")).toBe(0);
  });

  describe("guessMimeType", () => {
    it("detects common image types", () => {
      expect(guessMimeType("chart.png")).toBe("image/png");
      expect(guessMimeType("photo.jpg")).toBe("image/jpeg");
      expect(guessMimeType("photo.jpeg")).toBe("image/jpeg");
      expect(guessMimeType("icon.svg")).toBe("image/svg+xml");
      expect(guessMimeType("anim.gif")).toBe("image/gif");
      expect(guessMimeType("hero.webp")).toBe("image/webp");
    });

    it("detects document types", () => {
      expect(guessMimeType("doc.pdf")).toBe("application/pdf");
      expect(guessMimeType("data.json")).toBe("application/json");
      expect(guessMimeType("data.csv")).toBe("text/csv");
      expect(guessMimeType("page.html")).toBe("text/html");
      expect(guessMimeType("readme.txt")).toBe("text/plain");
    });

    it("returns octet-stream for unknown extensions", () => {
      expect(guessMimeType("file.xyz")).toBe("application/octet-stream");
      expect(guessMimeType("archive.tar.gz")).toBe("application/octet-stream");
    });
  });
});
