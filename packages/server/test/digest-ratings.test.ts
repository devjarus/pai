import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import {
  rateDigest,
  getDigestRating,
  getAverageRating,
  getRecentFeedback,
  getBeliefRatingBonus,
  digestRatingsMigrations,
} from "../src/digest-ratings.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("digest-ratings", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-ratings-"));
    storage = createStorage(dir);
    storage.migrate("digest_ratings", digestRatingsMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("rateDigest", () => {
    it("creates a rating and returns it", () => {
      const result = rateDigest(storage, "digest-1", 4, "Great digest");
      expect(result.digestId).toBe("digest-1");
      expect(result.rating).toBe(4);
      expect(result.feedback).toBe("Great digest");
      expect(result.id).toBeTruthy();
      expect(result.createdAt).toBeTruthy();
    });

    it("creates a rating without feedback", () => {
      const result = rateDigest(storage, "digest-2", 3);
      expect(result.rating).toBe(3);
      expect(result.feedback).toBeNull();
    });
  });

  describe("getDigestRating", () => {
    it("returns a rating for a digest", () => {
      rateDigest(storage, "digest-1", 4, "Pretty good");

      const result = getDigestRating(storage, "digest-1");
      expect(result).toBeDefined();
      expect(result!.rating).toBe(4);
      expect(result!.feedback).toBe("Pretty good");
      expect(result!.digestId).toBe("digest-1");
    });

    it("returns undefined when no rating exists", () => {
      const result = getDigestRating(storage, "nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("getAverageRating", () => {
    it("returns average of all ratings", () => {
      rateDigest(storage, "d1", 4);
      rateDigest(storage, "d2", 2);
      rateDigest(storage, "d3", 3);

      const avg = getAverageRating(storage);
      expect(avg).toBe(3);
    });

    it("returns average with limit parameter", () => {
      rateDigest(storage, "d1", 2);
      rateDigest(storage, "d2", 4);

      const avg = getAverageRating(storage, 10);
      expect(avg).toBe(3);
    });

    it("returns null when no ratings exist", () => {
      const avg = getAverageRating(storage);
      expect(avg).toBeNull();
    });
  });

  describe("getRecentFeedback", () => {
    it("returns recent feedback strings", () => {
      rateDigest(storage, "d1", 4, "Good");
      rateDigest(storage, "d2", 3); // no feedback
      rateDigest(storage, "d3", 5, "Excellent");

      const feedback = getRecentFeedback(storage);
      expect(feedback).toHaveLength(2);
      expect(feedback).toContain("Good");
      expect(feedback).toContain("Excellent");
    });

    it("returns empty array when no feedback", () => {
      rateDigest(storage, "d1", 3);
      const feedback = getRecentFeedback(storage);
      expect(feedback).toEqual([]);
    });

    it("respects limit parameter", () => {
      rateDigest(storage, "d1", 4, "A");
      rateDigest(storage, "d2", 4, "B");
      rateDigest(storage, "d3", 4, "C");

      const feedback = getRecentFeedback(storage, 2);
      expect(feedback).toHaveLength(2);
    });
  });

  describe("getBeliefRatingBonus", () => {
    it("returns 0 when no ratings exist", () => {
      // No brief_beliefs table, so the query will throw and return 0
      const bonus = getBeliefRatingBonus(storage, "belief-1");
      expect(bonus).toBe(0);
    });

    it("returns 0 when tables don't exist (graceful catch)", () => {
      // The brief_beliefs table doesn't exist in this test DB, so query will fail
      const bonus = getBeliefRatingBonus(storage, "nonexistent");
      expect(bonus).toBe(0);
    });
  });
});
