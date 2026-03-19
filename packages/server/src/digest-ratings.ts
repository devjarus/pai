import type { Storage, Migration } from "@personal-ai/core";

/**
 * Compute a rating-based score adjustment for a belief based on how
 * digests that used it were rated. Returns a bonus/penalty:
 *   high ratings (4-5) → positive bonus (up to +8)
 *   low ratings (1-2) → negative penalty (down to -10)
 *   no ratings or average → 0
 */
export function getBeliefRatingBonus(storage: Storage, beliefId: string): number {
  let rows: { rating: number }[];
  try {
    rows = storage.query<{ rating: number }>(
      `SELECT dr.rating
       FROM digest_ratings dr
       JOIN brief_beliefs bb ON bb.brief_id = dr.digest_id
       WHERE bb.belief_id = ?
       ORDER BY dr.created_at DESC
       LIMIT 5`,
      [beliefId],
    );
  } catch {
    return 0; // tables may not exist in test/harness environments
  }
  if (rows.length === 0) return 0;
  const avg = rows.reduce((sum, r) => sum + r.rating, 0) / rows.length;
  if (avg >= 4) return Math.round((avg - 3) * 4);   // 4→4, 5→8
  if (avg <= 2) return -Math.round((3 - avg) * 5);   // 2→-5, 1→-10
  return 0; // 3 = neutral
}

export interface DigestRating {
  id: string;
  digestId: string;
  rating: number;
  feedback: string | null;
  createdAt: string;
}

export const digestRatingsMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS digest_ratings (
        id TEXT PRIMARY KEY,
        digest_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        feedback TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_digest_ratings_digest ON digest_ratings(digest_id);
    `,
  },
];

export function rateDigest(
  storage: Storage,
  digestId: string,
  rating: number,
  feedback?: string,
): DigestRating {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  storage.run(
    "INSERT INTO digest_ratings (id, digest_id, rating, feedback, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, digestId, rating, feedback ?? null, now],
  );
  return { id, digestId, rating, feedback: feedback ?? null, createdAt: now };
}

export function getDigestRating(
  storage: Storage,
  digestId: string,
): DigestRating | undefined {
  const rows = storage.query<{
    id: string;
    digest_id: string;
    rating: number;
    feedback: string | null;
    created_at: string;
  }>(
    "SELECT id, digest_id, rating, feedback, created_at FROM digest_ratings WHERE digest_id = ? ORDER BY created_at DESC LIMIT 1",
    [digestId],
  );
  if (rows.length === 0) return undefined;
  const row = rows[0]!;
  return {
    id: row.id,
    digestId: row.digest_id,
    rating: row.rating,
    feedback: row.feedback,
    createdAt: row.created_at,
  };
}

export function getAverageRating(
  storage: Storage,
  limit?: number,
): number | null {
  const sql = limit
    ? "SELECT AVG(rating) as avg FROM (SELECT rating FROM digest_ratings ORDER BY created_at DESC LIMIT ?)"
    : "SELECT AVG(rating) as avg FROM digest_ratings";
  const rows = storage.query<{ avg: number | null }>(sql, limit ? [limit] : []);
  return rows[0]?.avg ?? null;
}

export function getRecentFeedback(
  storage: Storage,
  limit?: number,
): string[] {
  const rows = storage.query<{ feedback: string }>(
    "SELECT feedback FROM digest_ratings WHERE feedback IS NOT NULL AND feedback != '' ORDER BY created_at DESC LIMIT ?",
    [limit ?? 10],
  );
  return rows.map((row) => row.feedback);
}
