import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage } from "@personal-ai/core";
import {
  scheduleMigrations,
  createSchedule,
  listSchedules,
  getScheduleById,
  pauseSchedule,
  resumeSchedule,
  deleteSchedule,
  getDueSchedules,
  markScheduleRun,
} from "../src/schedules.js";

describe("schedules", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-schedule-test-"));
    storage = createStorage(dir);
    storage.migrate("schedules", scheduleMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("createSchedule", () => {
    it("creates a schedule with defaults", () => {
      const schedule = createSchedule(storage, {
        label: "AI news",
        goal: "Research AI news",
      });

      expect(schedule.id).toBeTruthy();
      expect(schedule.label).toBe("AI news");
      expect(schedule.goal).toBe("Research AI news");
      expect(schedule.type).toBe("research");
      expect(schedule.intervalHours).toBe(24);
      expect(schedule.status).toBe("active");
      expect(schedule.chatId).toBeNull();
      expect(schedule.threadId).toBeNull();
      expect(schedule.lastRunAt).toBeNull();
      expect(schedule.nextRunAt).toBeTruthy();
    });

    it("respects custom interval and chat/thread", () => {
      const schedule = createSchedule(storage, {
        label: "Weekly crypto",
        goal: "Research crypto market",
        intervalHours: 168,
        chatId: 12345,
        threadId: "thread-abc",
      });

      expect(schedule.intervalHours).toBe(168);
      expect(schedule.chatId).toBe(12345);
      expect(schedule.threadId).toBe("thread-abc");
    });

    it("sets nextRunAt in the future", () => {
      const before = Date.now();
      const schedule = createSchedule(storage, {
        label: "Test",
        goal: "Test goal",
        intervalHours: 12,
      });
      const nextRun = new Date(schedule.nextRunAt).getTime();
      // Should be ~12 hours from now (within 5s tolerance)
      expect(nextRun).toBeGreaterThan(before + 12 * 60 * 60 * 1000 - 5000);
      expect(nextRun).toBeLessThan(before + 12 * 60 * 60 * 1000 + 5000);
    });
  });

  describe("listSchedules", () => {
    it("returns all non-deleted schedules", () => {
      createSchedule(storage, { label: "A", goal: "Goal A" });
      createSchedule(storage, { label: "B", goal: "Goal B" });

      const list = listSchedules(storage);
      expect(list).toHaveLength(2);
    });

    it("filters by status", () => {
      const s = createSchedule(storage, { label: "A", goal: "Goal A" });
      createSchedule(storage, { label: "B", goal: "Goal B" });
      pauseSchedule(storage, s.id);

      expect(listSchedules(storage, "active")).toHaveLength(1);
      expect(listSchedules(storage, "paused")).toHaveLength(1);
    });

    it("excludes deleted schedules from default list", () => {
      const s = createSchedule(storage, { label: "A", goal: "Goal A" });
      createSchedule(storage, { label: "B", goal: "Goal B" });
      deleteSchedule(storage, s.id);

      expect(listSchedules(storage)).toHaveLength(1);
    });
  });

  describe("getScheduleById", () => {
    it("returns schedule by id", () => {
      const created = createSchedule(storage, { label: "Test", goal: "Test goal" });
      const found = getScheduleById(storage, created.id);

      expect(found).not.toBeNull();
      expect(found!.label).toBe("Test");
      expect(found!.goal).toBe("Test goal");
    });

    it("returns null for non-existent id", () => {
      expect(getScheduleById(storage, "nonexistent")).toBeNull();
    });
  });

  describe("pauseSchedule", () => {
    it("pauses an active schedule", () => {
      const s = createSchedule(storage, { label: "Test", goal: "Test goal" });
      const ok = pauseSchedule(storage, s.id);

      expect(ok).toBe(true);
      expect(getScheduleById(storage, s.id)!.status).toBe("paused");
    });

    it("returns false for already paused schedule", () => {
      const s = createSchedule(storage, { label: "Test", goal: "Test goal" });
      pauseSchedule(storage, s.id);
      expect(pauseSchedule(storage, s.id)).toBe(false);
    });

    it("returns false for non-existent schedule", () => {
      expect(pauseSchedule(storage, "nonexistent")).toBe(false);
    });
  });

  describe("resumeSchedule", () => {
    it("resumes a paused schedule", () => {
      const s = createSchedule(storage, { label: "Test", goal: "Test goal" });
      pauseSchedule(storage, s.id);
      const ok = resumeSchedule(storage, s.id);

      expect(ok).toBe(true);
      const updated = getScheduleById(storage, s.id)!;
      expect(updated.status).toBe("active");
      // Should have a new nextRunAt
      expect(new Date(updated.nextRunAt).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it("returns false for active schedule", () => {
      const s = createSchedule(storage, { label: "Test", goal: "Test goal" });
      expect(resumeSchedule(storage, s.id)).toBe(false);
    });

    it("returns false for non-existent schedule", () => {
      expect(resumeSchedule(storage, "nonexistent")).toBe(false);
    });
  });

  describe("deleteSchedule", () => {
    it("soft-deletes a schedule", () => {
      const s = createSchedule(storage, { label: "Test", goal: "Test goal" });
      const ok = deleteSchedule(storage, s.id);

      expect(ok).toBe(true);
      expect(getScheduleById(storage, s.id)!.status).toBe("deleted");
    });

    it("returns false for already deleted schedule", () => {
      const s = createSchedule(storage, { label: "Test", goal: "Test goal" });
      deleteSchedule(storage, s.id);
      expect(deleteSchedule(storage, s.id)).toBe(false);
    });
  });

  describe("getDueSchedules", () => {
    it("returns schedules with nextRunAt in the past", () => {
      // Create schedule with nextRunAt in the past by direct SQL
      const s = createSchedule(storage, { label: "Due", goal: "Due goal" });
      storage.run(
        "UPDATE scheduled_jobs SET next_run_at = datetime('now', '-1 hour') WHERE id = ?",
        [s.id],
      );

      const due = getDueSchedules(storage);
      expect(due).toHaveLength(1);
      expect(due[0]!.id).toBe(s.id);
    });

    it("does not return future schedules", () => {
      createSchedule(storage, { label: "Future", goal: "Future goal" });
      expect(getDueSchedules(storage)).toHaveLength(0);
    });

    it("does not return paused schedules even if due", () => {
      const s = createSchedule(storage, { label: "Paused", goal: "Paused goal" });
      storage.run(
        "UPDATE scheduled_jobs SET next_run_at = datetime('now', '-1 hour') WHERE id = ?",
        [s.id],
      );
      pauseSchedule(storage, s.id);

      expect(getDueSchedules(storage)).toHaveLength(0);
    });
  });

  describe("markScheduleRun", () => {
    it("updates lastRunAt and advances nextRunAt", () => {
      const s = createSchedule(storage, { label: "Test", goal: "Test goal", intervalHours: 6 });
      const beforeMark = Date.now();
      markScheduleRun(storage, s.id);

      const updated = getScheduleById(storage, s.id)!;
      expect(updated.lastRunAt).toBeTruthy();
      expect(new Date(updated.lastRunAt!).getTime()).toBeGreaterThanOrEqual(beforeMark - 1000);

      // nextRunAt should be ~6 hours from now
      const nextRun = new Date(updated.nextRunAt).getTime();
      expect(nextRun).toBeGreaterThan(beforeMark + 6 * 60 * 60 * 1000 - 5000);
    });

    it("does nothing for non-existent schedule", () => {
      // Should not throw
      markScheduleRun(storage, "nonexistent");
    });
  });
});
