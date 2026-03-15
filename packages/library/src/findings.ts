import type { Storage, Migration } from "@personal-ai/core";
import { nanoid } from "nanoid";

// ---- Types ----

export interface ResearchFindingSource {
  url: string;
  title: string;
  fetchedAt: string;
  relevance: number;
}

export interface ResearchFinding {
  id: string;
  watchId?: string;
  digestId?: string;
  goal: string;
  domain: string;
  summary: string;
  structuredData?: Record<string, unknown>;
  sources: ResearchFindingSource[];
  confidence: number;
  agentName: string;
  depthLevel: "quick" | "standard" | "deep";
  previousFindingId?: string;
  delta?: { changed: string[]; significance: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateFindingInput {
  watchId?: string;
  digestId?: string;
  goal: string;
  domain: string;
  summary: string;
  structuredData?: Record<string, unknown>;
  sources: ResearchFindingSource[];
  confidence: number;
  agentName: string;
  depthLevel: "quick" | "standard" | "deep";
  previousFindingId?: string;
  delta?: { changed: string[]; significance: number };
}

// ---- Migrations ----

export const findingsMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS research_findings (
        id TEXT PRIMARY KEY,
        watch_id TEXT,
        digest_id TEXT,
        goal TEXT NOT NULL,
        domain TEXT NOT NULL,
        summary TEXT NOT NULL,
        structured_data TEXT,
        sources TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL,
        agent_name TEXT NOT NULL,
        depth_level TEXT NOT NULL,
        previous_finding_id TEXT,
        delta TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_findings_watch_id ON research_findings(watch_id);
      CREATE INDEX IF NOT EXISTS idx_findings_domain ON research_findings(domain);
    `,
  },
  {
    version: 2,
    up: `
      CREATE VIRTUAL TABLE IF NOT EXISTS research_findings_fts USING fts5(summary, content=research_findings, content_rowid=rowid);
      CREATE TRIGGER research_findings_ai AFTER INSERT ON research_findings BEGIN
        INSERT INTO research_findings_fts(rowid, summary) VALUES (new.rowid, new.summary);
      END;
      CREATE TRIGGER research_findings_ad AFTER DELETE ON research_findings BEGIN
        INSERT INTO research_findings_fts(research_findings_fts, rowid, summary) VALUES ('delete', old.rowid, old.summary);
      END;
      CREATE TRIGGER research_findings_au AFTER UPDATE ON research_findings BEGIN
        INSERT INTO research_findings_fts(research_findings_fts, rowid, summary) VALUES ('delete', old.rowid, old.summary);
        INSERT INTO research_findings_fts(rowid, summary) VALUES (new.rowid, new.summary);
      END;
      INSERT INTO research_findings_fts(rowid, summary) SELECT rowid, summary FROM research_findings;
    `,
  },
  {
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS research_finding_embeddings (
        finding_id TEXT PRIMARY KEY REFERENCES research_findings(id) ON DELETE CASCADE,
        embedding TEXT NOT NULL
      );
    `,
  },
];

// ---- Row mapping ----

interface FindingRow {
  id: string;
  watch_id: string | null;
  digest_id: string | null;
  goal: string;
  domain: string;
  summary: string;
  structured_data: string | null;
  sources: string;
  confidence: number;
  agent_name: string;
  depth_level: string;
  previous_finding_id: string | null;
  delta: string | null;
  created_at: string;
  updated_at: string;
}

function rowToFinding(row: FindingRow): ResearchFinding {
  const finding: ResearchFinding = {
    id: row.id,
    goal: row.goal,
    domain: row.domain,
    summary: row.summary,
    sources: JSON.parse(row.sources) as ResearchFindingSource[],
    confidence: row.confidence,
    agentName: row.agent_name,
    depthLevel: row.depth_level as ResearchFinding["depthLevel"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.watch_id) finding.watchId = row.watch_id;
  if (row.digest_id) finding.digestId = row.digest_id;
  if (row.structured_data) finding.structuredData = JSON.parse(row.structured_data) as Record<string, unknown>;
  if (row.previous_finding_id) finding.previousFindingId = row.previous_finding_id;
  if (row.delta) finding.delta = JSON.parse(row.delta) as { changed: string[]; significance: number };
  return finding;
}

// ---- CRUD ----

export function createFinding(storage: Storage, input: CreateFindingInput): ResearchFinding {
  const id = nanoid();
  const now = new Date().toISOString();

  storage.run(
    `INSERT INTO research_findings (id, watch_id, digest_id, goal, domain, summary, structured_data, sources, confidence, agent_name, depth_level, previous_finding_id, delta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.watchId ?? null,
      input.digestId ?? null,
      input.goal,
      input.domain,
      input.summary,
      input.structuredData ? JSON.stringify(input.structuredData) : null,
      JSON.stringify(input.sources),
      input.confidence,
      input.agentName,
      input.depthLevel,
      input.previousFindingId ?? null,
      input.delta ? JSON.stringify(input.delta) : null,
      now,
      now,
    ],
  );

  return getFinding(storage, id)!;
}

export function getFinding(storage: Storage, id: string): ResearchFinding | undefined {
  const rows = storage.query<FindingRow>(
    "SELECT * FROM research_findings WHERE id = ?",
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  return rowToFinding(row);
}

export function listFindings(storage: Storage): ResearchFinding[] {
  const rows = storage.query<FindingRow>(
    "SELECT * FROM research_findings ORDER BY created_at DESC",
  );
  return rows.map(rowToFinding);
}

export function listFindingsForWatch(storage: Storage, watchId: string): ResearchFinding[] {
  const rows = storage.query<FindingRow>(
    "SELECT * FROM research_findings WHERE watch_id = ? ORDER BY created_at DESC",
    [watchId],
  );
  return rows.map(rowToFinding);
}

export function deleteFinding(storage: Storage, id: string): void {
  storage.run("DELETE FROM research_findings WHERE id = ?", [id]);
}
