import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "../src/storage.js";
import { finishSpan, startSpan, telemetryMigrations } from "../src/telemetry.js";
import { collectRecurringTelemetryFailures, linearIssueRegistryMigrations, syncAutomaticLinearIssues } from "../src/linear-auto-issues.js";
import type { Storage, Logger, Config } from "../src/types.js";

describe("automatic Linear issues", () => {
  let dir: string;
  let storage: Storage;
  let logger: Logger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-linear-auto-"));
    storage = createStorage(dir);
    storage.migrate("telemetry", telemetryMigrations);
    storage.migrate("linear_issue_registry", linearIssueRegistryMigrations);
    logger = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function recordError(process: string, errorMessage: string): void {
    const span = startSpan({ storage }, {
      spanType: "worker",
      process,
      surface: "worker",
    });
    finishSpan({ storage }, span, {
      status: "error",
      errorMessage,
    });
  }

  it("collects only recurring error groups that cross the threshold", () => {
    recordError("worker.learning", "Request 123 failed");
    recordError("worker.learning", "Request 456 failed");
    recordError("worker.learning", "Request 789 failed");
    recordError("chat.main", "Provider timeout");

    const candidates = collectRecurringTelemetryFailures(storage);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      process: "worker.learning",
      count: 3,
      threshold: 3,
    });
  });

  it("creates one Linear issue per recurring error fingerprint", async () => {
    recordError("worker.learning", "Request 123 failed");
    recordError("worker.learning", "Request 456 failed");
    recordError("worker.learning", "Request 789 failed");

    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          teams: {
            nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }],
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "issue-1",
              identifier: "ENG-201",
              title: "Recurring worker.learning failure",
              url: "https://linear.app/acme/issue/ENG-201",
              team: { id: "team-1", key: "ENG", name: "Engineering" },
              project: null,
            },
          },
        },
      }), { status: 200 }));

    const result = await syncAutomaticLinearIssues(storage, {
      dataDir: dir,
      logLevel: "silent",
      llm: { provider: "ollama", model: "llama3.2", baseUrl: "http://127.0.0.1:11434" },
      plugins: [],
      linear: {
        enabled: true,
        autoCreateRecurringIssues: true,
        apiKey: "lin_api_key",
        defaultTeam: "ENG",
      },
    } satisfies Config, logger);

    expect(result.created).toBe(1);
    const rows = storage.query<{ issue_identifier: string; occurrence_count: number }>(
      "SELECT issue_identifier, occurrence_count FROM linear_issue_registry",
    );
    expect(rows).toEqual([{ issue_identifier: "ENG-201", occurrence_count: 3 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not create duplicate issues for an already tracked fingerprint", async () => {
    recordError("worker.learning", "Request 123 failed");
    recordError("worker.learning", "Request 456 failed");
    recordError("worker.learning", "Request 789 failed");

    storage.run(
      `INSERT INTO linear_issue_registry (
        fingerprint, source, issue_id, issue_identifier, issue_url, title,
        occurrence_count, first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (?, 'telemetry', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        collectRecurringTelemetryFailures(storage)[0]!.fingerprint,
        "issue-1",
        "ENG-201",
        "https://linear.app/acme/issue/ENG-201",
        "Recurring worker.learning failure",
        3,
        "2026-03-23T00:00:00.000Z",
        "2026-03-23T00:00:00.000Z",
        "2026-03-23T00:00:00.000Z",
        "2026-03-23T00:00:00.000Z",
      ],
    );

    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("fetch should not be called"));

    const result = await syncAutomaticLinearIssues(storage, {
      dataDir: dir,
      logLevel: "silent",
      llm: { provider: "ollama", model: "llama3.2", baseUrl: "http://127.0.0.1:11434" },
      plugins: [],
      linear: {
        enabled: true,
        autoCreateRecurringIssues: true,
        apiKey: "lin_api_key",
        defaultTeam: "ENG",
      },
    } satisfies Config, logger);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
