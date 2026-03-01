/**
 * Artifact storage — binary blobs (charts, images, files) associated with jobs.
 * Stored in SQLite as BLOBs for simplicity (personal tool, not enterprise scale).
 */

import { nanoid } from "nanoid";
import type { Storage, Migration } from "./types.js";

export interface Artifact {
  id: string;
  jobId: string;
  name: string;
  mimeType: string;
  data: Buffer;
  createdAt: string;
}

export interface ArtifactMeta {
  id: string;
  jobId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

interface ArtifactRow {
  id: string;
  job_id: string;
  name: string;
  mime_type: string;
  data: Buffer;
  created_at: string;
}

interface ArtifactMetaRow {
  id: string;
  job_id: string;
  name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export const artifactMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        data BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
    `,
  },
];

/**
 * Store an artifact (chart image, output file, etc.).
 * Returns the artifact ID.
 */
export function storeArtifact(
  storage: Storage,
  opts: { jobId: string; name: string; mimeType: string; data: Buffer },
): string {
  const id = nanoid();
  storage.run(
    "INSERT INTO artifacts (id, job_id, name, mime_type, data, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    [id, opts.jobId, opts.name, opts.mimeType, opts.data],
  );
  return id;
}

/**
 * Retrieve an artifact by ID (includes binary data).
 */
export function getArtifact(storage: Storage, id: string): Artifact | null {
  const rows = storage.query<ArtifactRow>(
    "SELECT * FROM artifacts WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    mimeType: row.mime_type,
    data: row.data,
    createdAt: row.created_at,
  };
}

/**
 * List artifacts for a job (metadata only, no binary data).
 */
export function listArtifacts(storage: Storage, jobId: string): ArtifactMeta[] {
  const rows = storage.query<ArtifactMetaRow>(
    "SELECT id, job_id, name, mime_type, length(data) as size, created_at FROM artifacts WHERE job_id = ?",
    [jobId],
  );
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  }));
}

/**
 * Delete all artifacts for a job.
 */
export function deleteJobArtifacts(storage: Storage, jobId: string): number {
  const count = storage.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM artifacts WHERE job_id = ?",
    [jobId],
  )[0]?.cnt ?? 0;
  storage.run("DELETE FROM artifacts WHERE job_id = ?", [jobId]);
  return count;
}

/**
 * Guess MIME type from file extension.
 */
export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "svg": return "image/svg+xml";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    case "json": return "application/json";
    case "csv": return "text/csv";
    case "html": return "text/html";
    case "txt": return "text/plain";
    default: return "application/octet-stream";
  }
}
