import { createHash } from "node:crypto";
import type { Config, Logger, Migration, Storage } from "./types.js";
import { createLinearIssue, isLinearIssueIntakeConfigured } from "./linear.js";

const TELEMETRY_ERROR_WINDOW_HOURS = 24;
const TELEMETRY_ERROR_SCAN_LIMIT = 250;

export const linearIssueRegistryMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS linear_issue_registry (
        fingerprint TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        issue_identifier TEXT NOT NULL,
        issue_url TEXT NOT NULL,
        title TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_linear_issue_registry_source ON linear_issue_registry(source);
      CREATE INDEX IF NOT EXISTS idx_linear_issue_registry_last_seen_at ON linear_issue_registry(last_seen_at);
    `,
  },
];

interface TelemetryErrorRow {
  process: string;
  surface: string | null;
  route: string | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  started_at: string;
}

interface IssueRegistryRow {
  fingerprint: string;
  issue_identifier: string;
  issue_url: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AutomaticLinearIssueSummary {
  created: number;
  updated: number;
  candidates: number;
  skipped: number;
  reason?: "disabled" | "not_configured";
}

interface TelemetryIssueCandidate {
  fingerprint: string;
  process: string;
  surface: string | null;
  route: string | null;
  normalizedError: string;
  exampleError: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  provider: string | null;
  model: string | null;
  threshold: number;
}

function normalizeErrorMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi, "<timestamp>")
    .replace(/\b\/[A-Za-z0-9._/-]{8,}\b/g, "<path>")
    .replace(/\b\d+\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function fingerprintTelemetryFailure(process: string, route: string | null, normalizedError: string): string {
  return createHash("sha256")
    .update(`${process}|${route ?? ""}|${normalizedError}`)
    .digest("hex");
}

function thresholdForProcess(process: string): number {
  if (process.startsWith("worker.")) return 3;
  if (process.startsWith("chat.") || process.startsWith("research.") || process.startsWith("swarm.")) return 5;
  return 4;
}

function buildIssueTitle(candidate: TelemetryIssueCandidate): string {
  if (candidate.route) {
    return `Recurring ${candidate.process} failure on ${candidate.route}`;
  }
  return `Recurring ${candidate.process} failure`;
}

function buildIssueDescription(candidate: TelemetryIssueCandidate): string {
  const lines = [
    "## Auto-detected recurring failure",
    `- Process: ${candidate.process}`,
    `- Threshold: ${candidate.threshold} in ${TELEMETRY_ERROR_WINDOW_HOURS}h`,
    `- Observed count: ${candidate.count}`,
    `- First seen: ${candidate.firstSeenAt}`,
    `- Last seen: ${candidate.lastSeenAt}`,
    ...(candidate.surface ? [`- Surface: ${candidate.surface}`] : []),
    ...(candidate.route ? [`- Route: ${candidate.route}`] : []),
    ...(candidate.provider ? [`- Provider: ${candidate.provider}`] : []),
    ...(candidate.model ? [`- Model: ${candidate.model}`] : []),
    "",
    "## Sample error",
    "```text",
    candidate.exampleError,
    "```",
    "",
    "This issue was created automatically because the same normalized failure fingerprint crossed the recurring-error threshold. The system will avoid creating duplicate issues for the same fingerprint.",
  ];
  return lines.join("\n");
}

export function collectRecurringTelemetryFailures(
  storage: Storage,
  options?: { sinceHours?: number; limit?: number },
): TelemetryIssueCandidate[] {
  const sinceHours = options?.sinceHours ?? TELEMETRY_ERROR_WINDOW_HOURS;
  const limit = options?.limit ?? TELEMETRY_ERROR_SCAN_LIMIT;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
  const rows = storage.query<TelemetryErrorRow>(
    `SELECT process, surface, route, error_message, provider, model, started_at
       FROM telemetry_spans
      WHERE status = 'error'
        AND started_at >= ?
      ORDER BY started_at DESC
      LIMIT ?`,
    [since, limit],
  );

  const groups = new Map<string, TelemetryIssueCandidate>();
  for (const row of rows) {
    const exampleError = (row.error_message ?? "Unknown error").trim() || "Unknown error";
    const normalizedError = normalizeErrorMessage(exampleError);
    const fingerprint = fingerprintTelemetryFailure(row.process, row.route, normalizedError);
    const current = groups.get(fingerprint);
    if (current) {
      current.count += 1;
      if (row.started_at < current.firstSeenAt) current.firstSeenAt = row.started_at;
      if (row.started_at > current.lastSeenAt) current.lastSeenAt = row.started_at;
      continue;
    }

    groups.set(fingerprint, {
      fingerprint,
      process: row.process,
      surface: row.surface,
      route: row.route,
      normalizedError,
      exampleError,
      count: 1,
      firstSeenAt: row.started_at,
      lastSeenAt: row.started_at,
      provider: row.provider,
      model: row.model,
      threshold: thresholdForProcess(row.process),
    });
  }

  return [...groups.values()]
    .filter((candidate) => candidate.count >= candidate.threshold)
    .sort((a, b) => b.count - a.count || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

export async function syncAutomaticLinearIssues(
  storage: Storage,
  config: Config,
  logger?: Logger,
): Promise<AutomaticLinearIssueSummary> {
  if (!config.linear?.autoCreateRecurringIssues) {
    return { created: 0, updated: 0, candidates: 0, skipped: 0, reason: "disabled" };
  }
  if (!isLinearIssueIntakeConfigured(config.linear)) {
    return { created: 0, updated: 0, candidates: 0, skipped: 0, reason: "not_configured" };
  }

  const candidates = collectRecurringTelemetryFailures(storage);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const existing = storage.query<IssueRegistryRow>(
      `SELECT fingerprint, issue_identifier, issue_url, occurrence_count, first_seen_at, last_seen_at
         FROM linear_issue_registry
        WHERE fingerprint = ?
        LIMIT 1`,
      [candidate.fingerprint],
    )[0];
    const now = new Date().toISOString();

    if (existing) {
      storage.run(
        `UPDATE linear_issue_registry
            SET occurrence_count = ?,
                first_seen_at = ?,
                last_seen_at = ?,
                updated_at = ?
          WHERE fingerprint = ?`,
        [candidate.count, existing.first_seen_at, candidate.lastSeenAt, now, candidate.fingerprint],
      );
      updated += 1;
      continue;
    }

    try {
      const issue = await createLinearIssue(config.linear, {
        title: buildIssueTitle(candidate),
        description: buildIssueDescription(candidate),
        priority: 2,
      });
      storage.run(
        `INSERT INTO linear_issue_registry (
          fingerprint, source, issue_id, issue_identifier, issue_url, title,
          occurrence_count, first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES (?, 'telemetry', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          candidate.fingerprint,
          issue.id,
          issue.identifier,
          issue.url,
          issue.title,
          candidate.count,
          candidate.firstSeenAt,
          candidate.lastSeenAt,
          now,
          now,
        ],
      );
      created += 1;
      logger?.info("Automatic Linear issue created for recurring failure", {
        fingerprint: candidate.fingerprint,
        issueIdentifier: issue.identifier,
        process: candidate.process,
        count: candidate.count,
      });
    } catch (error) {
      skipped += 1;
      logger?.warn("Automatic Linear issue creation failed", {
        fingerprint: candidate.fingerprint,
        process: candidate.process,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { created, updated, candidates: candidates.length, skipped };
}
