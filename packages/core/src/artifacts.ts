/**
 * Artifact storage — binary files (charts, images, reports) associated with jobs.
 * Files stored on disk at {dataDir}/artifacts/{id}{ext}, metadata in SQLite.
 */

import { nanoid } from "nanoid";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
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
  file_path: string;
  size: number;
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
  {
    version: 2,
    up: `
      DROP TABLE IF EXISTS artifacts;
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        file_path TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
    `,
  },
];

/** Ensure the artifacts directory exists and return its path. */
function ensureArtifactsDir(dataDir: string): string {
  const dir = join(dataDir, "artifacts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Get file extension from MIME type or filename. */
function getExt(name: string, mimeType: string): string {
  const fromName = extname(name);
  if (fromName) return fromName;
  // Fallback from MIME
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
    "application/json": ".json",
    "text/csv": ".csv",
    "text/html": ".html",
    "text/plain": ".txt",
    "text/markdown": ".md",
  };
  return map[mimeType] ?? ".bin";
}

/**
 * Store an artifact (chart image, output file, etc.).
 * Writes file to disk and stores metadata in SQLite.
 * Returns the artifact ID.
 */
export function storeArtifact(
  storage: Storage,
  dataDir: string,
  opts: { jobId: string; name: string; mimeType: string; data: Buffer },
): string {
  const id = nanoid();
  const ext = getExt(opts.name, opts.mimeType);
  const dir = ensureArtifactsDir(dataDir);
  const filePath = join(dir, `${id}${ext}`);

  writeFileSync(filePath, opts.data);

  storage.run(
    "INSERT INTO artifacts (id, job_id, name, mime_type, file_path, size, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
    [id, opts.jobId, opts.name, opts.mimeType, filePath, opts.data.length],
  );
  return id;
}

/**
 * Retrieve an artifact by ID (reads binary data from disk).
 */
export function getArtifact(storage: Storage, id: string): Artifact | null {
  const rows = storage.query<ArtifactRow>(
    "SELECT id, job_id, name, mime_type, file_path, size, created_at FROM artifacts WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;

  // Read file from disk
  let data: Buffer;
  try {
    data = readFileSync(row.file_path);
  } catch {
    // File missing on disk — return null
    return null;
  }

  return {
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    mimeType: row.mime_type,
    data,
    createdAt: row.created_at,
  };
}

/**
 * List artifacts for a job (metadata only, no binary data).
 */
export function listArtifacts(storage: Storage, jobId: string): ArtifactMeta[] {
  const rows = storage.query<ArtifactMetaRow>(
    "SELECT id, job_id, name, mime_type, size, created_at FROM artifacts WHERE job_id = ?",
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
 * Delete all artifacts for a job (files + metadata).
 */
export function deleteJobArtifacts(storage: Storage, jobId: string): number {
  const rows = storage.query<{ file_path: string }>(
    "SELECT file_path FROM artifacts WHERE job_id = ?",
    [jobId],
  );

  // Delete files from disk
  for (const row of rows) {
    try { unlinkSync(row.file_path); } catch { /* file may already be gone */ }
  }

  storage.run("DELETE FROM artifacts WHERE job_id = ?", [jobId]);
  return rows.length;
}

/**
 * Delete artifacts older than maxAgeDays.
 * Returns the number of artifacts cleaned up.
 */
export function cleanupOldArtifacts(storage: Storage, dataDir: string, maxAgeDays: number): number {
  const rows = storage.query<{ id: string; file_path: string }>(
    "SELECT id, file_path FROM artifacts WHERE created_at < datetime('now', ?)",
    [`-${maxAgeDays} days`],
  );

  for (const row of rows) {
    try { unlinkSync(row.file_path); } catch { /* file may already be gone */ }
  }

  if (rows.length > 0) {
    storage.run(
      "DELETE FROM artifacts WHERE created_at < datetime('now', ?)",
      [`-${maxAgeDays} days`],
    );
  }

  // Also clean up orphaned files on disk that have no DB record
  try {
    const dir = join(dataDir, "artifacts");
    if (existsSync(dir)) {
      const dbPaths = new Set(
        storage.query<{ file_path: string }>("SELECT file_path FROM artifacts", [])
          .map((r) => r.file_path),
      );
      for (const file of readdirSync(dir)) {
        const fullPath = join(dir, file);
        if (!dbPaths.has(fullPath)) {
          // Only clean up orphans older than 1 hour (avoid race with in-progress writes)
          try {
            const stat = statSync(fullPath);
            if (Date.now() - stat.mtimeMs > 60 * 60 * 1000) {
              unlinkSync(fullPath);
            }
          } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore cleanup errors */ }

  return rows.length;
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
