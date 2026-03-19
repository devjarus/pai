import { randomUUID } from "node:crypto";
import type { PluginContext } from "@personal-ai/core";
import { cleanupExpiredSources, cleanupOldArtifacts, listBeliefs, listThreads, cleanupOldTelemetrySpans, startSpan, finishSpan } from "@personal-ai/core";
import { cleanupFindings } from "@personal-ai/library";
import { getDueSchedules, markScheduleRun } from "@personal-ai/plugin-schedules";
import { resolveDepthForWatch, getPreviousFindingsContext } from "@personal-ai/watches";
import { getLatestBriefing } from "./briefing.js";
import { runBackgroundLearning } from "./learning.js";

export interface WorkerOptions {
  briefingIntervalMs?: number;
  scheduleCheckIntervalMs?: number;
  learningIntervalMs?: number;
  learningInitialDelayMs?: number;
  knowledgeCleanupIntervalMs?: number;
  artifactCleanupIntervalMs?: number;
  generateInitialBriefing?: boolean;
}

const DEFAULT_BRIEFING_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_LEARNING_INTERVAL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_LEARNING_INITIAL_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_KNOWLEDGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ARTIFACT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TELEMETRY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ARTIFACT_MAX_AGE_DAYS = 7;

/**
 * Build a research goal that includes context from the previous brief
 * so the LLM focuses on what's NEW instead of repeating old findings.
 */
export function buildEnrichedResearchGoal(
  storage: { query: <T>(sql: string, params?: unknown[]) => T[] },
  schedule: { goal: string; latestBriefId?: string | null; lastDeliveredAt?: string | null },
): string {
  if (!schedule.latestBriefId) return schedule.goal;

  let previousSummary = "";
  try {
    const rows = storage.query<{ sections: string }>(
      "SELECT sections FROM briefings WHERE id = ? LIMIT 1",
      [schedule.latestBriefId],
    );
    if (rows[0]) {
      const sections = JSON.parse(rows[0].sections);
      const rec = sections.recommendation;
      if (rec?.summary) {
        previousSummary = rec.summary;
      }
      if (Array.isArray(sections.what_changed) && sections.what_changed.length > 0) {
        const changes = sections.what_changed
          .map((c: { title?: string }) => c.title ?? c)
          .filter(Boolean)
          .slice(0, 3);
        if (changes.length > 0) {
          previousSummary += ` Key changes noted: ${changes.join("; ")}.`;
        }
      }
    }
  } catch {
    // Failed to parse previous brief — fall back to plain goal
  }

  if (!previousSummary) return schedule.goal;

  const sinceDate = schedule.lastDeliveredAt
    ? new Date(schedule.lastDeliveredAt).toISOString().split("T")[0]
    : null;
  const sinceClause = sinceDate ? ` since ${sinceDate}` : "";

  return (
    `${schedule.goal}\n\n` +
    `CONTEXT — WHAT WAS ALREADY COVERED (use as baseline, not as your report):\n` +
    `${previousSummary}\n\n` +
    `Your job${sinceClause}: find FRESH information the previous report missed. ` +
    `Look for new developments, updated numbers, different sources, emerging trends, ` +
    `contrarian takes, or deeper details. There is ALWAYS something new to report — dig harder.`
  );
}

export class WorkerLoop {
  private briefingTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private learningInitTimer: ReturnType<typeof setTimeout> | null = null;
  private learningTimer: ReturnType<typeof setInterval> | null = null;
  private knowledgeCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private artifactCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private telemetryCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private abortController = new AbortController();

  constructor(
    private ctx: PluginContext,
    private options?: WorkerOptions,
  ) {}

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const isLLMConfigured = !!this.ctx.config.llm.apiKey || this.ctx.config.llm.provider === "ollama";

    const briefingMs = this.options?.briefingIntervalMs ?? DEFAULT_BRIEFING_INTERVAL_MS;
    const scheduleMs = this.options?.scheduleCheckIntervalMs ?? DEFAULT_SCHEDULE_CHECK_INTERVAL_MS;
    const learningMs = this.options?.learningIntervalMs ?? DEFAULT_LEARNING_INTERVAL_MS;
    const learningDelayMs = this.options?.learningInitialDelayMs ?? DEFAULT_LEARNING_INITIAL_DELAY_MS;
    const generateInitial = this.options?.generateInitialBriefing ?? true;

    if (!isLLMConfigured) {
      this.ctx.logger.info("LLM not configured — skipping background briefing and learning. Configure in Settings.");
    }

    // --- Briefing generator ---
    // If briefingTime is set (e.g. "08:00"), generate once daily at that time.
    // Otherwise fall back to interval-based generation.
    const briefingTime = this.ctx.config.workers?.briefingTime;

    if (briefingTime) {
      // Time-of-day mode: check every 30 min if it's time
      this.briefingTimer = setInterval(() => {
        if (this.ctx.config.workers?.briefing === false || !isLLMConfigured) return;

        const now = new Date();
        const tz = this.ctx.config.timezone;
        const formatter = new Intl.DateTimeFormat("en-US", {
          hour: "2-digit", minute: "2-digit", hour12: false,
          ...(tz ? { timeZone: tz } : {}),
        });
        const currentTime = formatter.format(now); // "08:30"
        const targetParts = briefingTime.split(":").map(Number);
        const currentParts = currentTime.split(":").map(Number);
        const targetH = targetParts[0] ?? 0;
        const targetM = targetParts[1] ?? 0;
        const currentH = currentParts[0] ?? 0;
        const currentM = currentParts[1] ?? 0;

        // Within 30-min window of target time
        const targetMinutes = targetH * 60 + targetM;
        const currentMinutes = currentH * 60 + currentM;
        const diff = Math.abs(currentMinutes - targetMinutes);
        if (diff > 30) return;

        // Check if already generated today
        const latest = getLatestBriefing(this.ctx.storage);
        if (latest) {
          const latestDate = new Date(latest.generatedAt);
          const today = new Date();
          if (latestDate.toDateString() === today.toDateString()) return; // already generated today
        }

        this.runWorkerTask("worker.briefing", async () => {
          this.ctx.backgroundJobs?.enqueueBriefing?.({ sourceKind: "maintenance", reason: "scheduled" });
        }).catch((err) => {
          this.ctx.logger.warn(`Background briefing queueing failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 30 * 60 * 1000); // check every 30 min
    } else {
      // Interval mode (existing behavior)
      this.briefingTimer = setInterval(() => {
        if (this.ctx.config.workers?.briefing === false || !isLLMConfigured) return;
        this.runWorkerTask("worker.briefing", async () => {
          this.ctx.backgroundJobs?.enqueueBriefing?.({ sourceKind: "maintenance", reason: "interval" });
        }).catch((err) => {
          this.ctx.logger.warn(`Background briefing queueing failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, briefingMs);
    }

    if (generateInitial && isLLMConfigured && this.ctx.config.workers?.briefing !== false) {
      const latest = getLatestBriefing(this.ctx.storage);
      if (!latest) {
        // Skip if no user data exists yet — avoids a useless "no data" briefing on first boot
        const hasData =
          listBeliefs(this.ctx.storage, "active").length > 0 ||
          listThreads(this.ctx.storage).length > 0;
        if (hasData) {
          this.runWorkerTask("worker.briefing", async () => {
            this.ctx.backgroundJobs?.enqueueBriefing?.({ sourceKind: "maintenance", reason: "startup" });
          }).catch((err) => {
            this.ctx.logger.warn(`Initial briefing queueing failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }
    }

    // --- Schedule runner ---
    this.scheduleCheckTimer = setInterval(() => {
      this.runWorkerTask("worker.schedule", () => this.runDueSchedules()).catch(() => {});
    }, scheduleMs);

    // --- Background learning ---
    this.learningInitTimer = setTimeout(() => {
      if (this.ctx.config.workers?.backgroundLearning === false || !isLLMConfigured) return;
      this.runWorkerTask("worker.learning", (telemetry) => runBackgroundLearning(this.ctx, this.abortController.signal, telemetry)).catch((err) => {
        this.ctx.logger.warn(`Background learning failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, learningDelayMs);

    this.learningTimer = setInterval(() => {
      if (this.ctx.config.workers?.backgroundLearning === false || !isLLMConfigured) return;
      this.runWorkerTask("worker.learning", (telemetry) => runBackgroundLearning(this.ctx, this.abortController.signal, telemetry)).catch((err) => {
        this.ctx.logger.warn(`Background learning failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, learningMs);

    // --- Knowledge cleanup ---
    const knowledgeCleanupMs = this.options?.knowledgeCleanupIntervalMs ?? DEFAULT_KNOWLEDGE_CLEANUP_INTERVAL_MS;
    this.knowledgeCleanupTimer = setInterval(() => {
      if (this.ctx.config.workers?.knowledgeCleanup === false) return;
      this.runWorkerTask("worker.cleanup", async () => {
        const defaultTtlDays = this.ctx.config.knowledge?.defaultTtlDays ?? 90;
        const result = cleanupExpiredSources(this.ctx.storage, { defaultTtlDays });
        if (result.deleted > 0) {
          this.ctx.logger.info(`Knowledge cleanup: deleted ${result.deleted} expired source(s)`);
        }
      }).catch((err) => {
        this.ctx.logger.warn(`Knowledge cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, knowledgeCleanupMs);

    // --- Artifact cleanup ---
    const artifactCleanupMs = this.options?.artifactCleanupIntervalMs ?? DEFAULT_ARTIFACT_CLEANUP_INTERVAL_MS;
    this.artifactCleanupTimer = setInterval(() => {
      this.runWorkerTask("worker.cleanup", async () => {
        const deleted = cleanupOldArtifacts(this.ctx.storage, this.ctx.config.dataDir, DEFAULT_ARTIFACT_MAX_AGE_DAYS);
        if (deleted > 0) {
          this.ctx.logger.info(`Artifact cleanup: deleted ${deleted} old artifact(s)`);
        }
      }).catch((err) => {
        this.ctx.logger.warn(`Artifact cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, artifactCleanupMs);

    // --- Findings cleanup (keep 5 per watch, delete orphans > 30 days) ---
    setInterval(() => {
      this.runWorkerTask("worker.cleanup", async () => {
        const deleted = cleanupFindings(this.ctx.storage, { maxAgeDays: 30, keepPerWatch: 5 });
        if (deleted > 0) {
          this.ctx.logger.info(`Findings cleanup: pruned ${deleted} old finding(s)`);
        }
      }).catch((err) => {
        this.ctx.logger.warn(`Findings cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, DEFAULT_TELEMETRY_CLEANUP_INTERVAL_MS); // same 24h interval as telemetry

    // --- Belief pruning (remove decayed beliefs, every 24h) ---
    setInterval(() => {
      this.runWorkerTask("worker.cleanup", async () => {
        const { pruneBeliefs } = await import("@personal-ai/core");
        const pruned = pruneBeliefs(this.ctx.storage);
        if (pruned.length > 0) {
          this.ctx.logger.info(`Belief pruning: removed ${pruned.length} decayed belief(s)`);
        }
      }).catch((err) => {
        this.ctx.logger.warn(`Belief pruning failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, DEFAULT_TELEMETRY_CLEANUP_INTERVAL_MS);

    // --- Belief dedup (merge near-duplicate beliefs, every 24h) ---
    setInterval(() => {
      this.runWorkerTask("worker.cleanup", async () => {
        const { reflect, mergeDuplicates } = await import("@personal-ai/core");
        const result = reflect(this.ctx.storage, { similarityThreshold: 0.85, limit: 200 });
        if (result.duplicates.length > 0) {
          const { merged } = mergeDuplicates(this.ctx.storage, result.duplicates);
          if (merged > 0) {
            this.ctx.logger.info(`Belief dedup: merged ${merged} duplicate belief(s) from ${result.duplicates.length} cluster(s)`);
          }
        }
      }).catch((err) => {
        this.ctx.logger.warn(`Belief dedup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, DEFAULT_TELEMETRY_CLEANUP_INTERVAL_MS);

    const telemetryCleanupMs = DEFAULT_TELEMETRY_CLEANUP_INTERVAL_MS;
    this.telemetryCleanupTimer = setInterval(() => {
      this.runWorkerTask("worker.cleanup", async () => {
        const deleted = cleanupOldTelemetrySpans(this.ctx.storage);
        if (deleted > 0) {
          this.ctx.logger.info(`Telemetry cleanup: deleted ${deleted} old span(s)`);
        }
      }).catch((err) => {
        this.ctx.logger.warn(`Telemetry cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, telemetryCleanupMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.abortController.abort();

    if (this.briefingTimer) { clearInterval(this.briefingTimer); this.briefingTimer = null; }
    if (this.scheduleCheckTimer) { clearInterval(this.scheduleCheckTimer); this.scheduleCheckTimer = null; }
    if (this.learningInitTimer) { clearTimeout(this.learningInitTimer); this.learningInitTimer = null; }
    if (this.learningTimer) { clearInterval(this.learningTimer); this.learningTimer = null; }
    if (this.knowledgeCleanupTimer) { clearInterval(this.knowledgeCleanupTimer); this.knowledgeCleanupTimer = null; }
    if (this.artifactCleanupTimer) { clearInterval(this.artifactCleanupTimer); this.artifactCleanupTimer = null; }
    if (this.telemetryCleanupTimer) { clearInterval(this.telemetryCleanupTimer); this.telemetryCleanupTimer = null; }
  }

  updateContext(newCtx: Partial<PluginContext>): void {
    Object.assign(this.ctx, newCtx);
  }

  private hasQueuedOrRunningSchedule(scheduleId: string, type: "research" | "analysis"): boolean {
    if (type === "research") {
      const rows = this.ctx.storage.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM research_jobs WHERE source_schedule_id = ? AND status IN ('pending', 'running')",
        [scheduleId],
      );
      return (rows[0]?.count ?? 0) > 0;
    }

    const rows = this.ctx.storage.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM swarm_jobs WHERE source_schedule_id = ? AND status IN ('pending', 'planning', 'running', 'synthesizing')",
      [scheduleId],
    );
    return (rows[0]?.count ?? 0) > 0;
  }

  private async runDueSchedules(): Promise<void> {
    try {
      const due = getDueSchedules(this.ctx.storage);
      for (const schedule of due) {
        if (this.hasQueuedOrRunningSchedule(schedule.id, schedule.type)) {
          continue;
        }
        this.ctx.logger.info("Running scheduled job", { id: schedule.id, label: schedule.label });
        markScheduleRun(this.ctx.storage, schedule.id);

        if (schedule.type === "research") {
          const enrichedGoal = buildEnrichedResearchGoal(this.ctx.storage, {
            goal: schedule.goal,
            latestBriefId: schedule.runtimeState?.latestBriefId,
            lastDeliveredAt: schedule.runtimeState?.lastDeliveredAt,
          });
          const findingsContext = getPreviousFindingsContext(this.ctx.storage, schedule.id);

          const fullGoal = enrichedGoal + findingsContext;
          const depth = resolveDepthForWatch({ depthLevel: (schedule as { depthLevel?: "quick" | "standard" | "deep" }).depthLevel }, false);
          await this.ctx.backgroundJobs?.enqueueResearch?.({
            goal: fullGoal,
            threadId: schedule.threadId,
            sourceKind: "schedule",
            sourceScheduleId: schedule.id,
            budgetMaxSearches: depth.budgetMaxSearches,
            budgetMaxPages: depth.budgetMaxPages,
          });
          continue;
        }

        await this.ctx.backgroundJobs?.enqueueSwarm?.({
          goal: schedule.goal,
          threadId: schedule.threadId,
          sourceKind: "schedule",
          sourceScheduleId: schedule.id,
        });
      }
    } catch (err) {
      this.ctx.logger.warn(`Schedule runner error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runWorkerTask(
    process: "worker.briefing" | "worker.learning" | "worker.schedule" | "worker.cleanup",
    task: (telemetry: { traceId: string; runId: string }) => Promise<void>,
  ): Promise<void> {
    const runId = `${process}-${randomUUID()}`;
    const span = startSpan({ storage: this.ctx.storage, logger: this.ctx.logger }, {
      spanType: "worker",
      process,
      surface: "worker",
      runId,
      metadata: { worker: process },
    });

    try {
      await task({ traceId: span.traceId, runId });
      finishSpan({ storage: this.ctx.storage, logger: this.ctx.logger }, span, {
        status: "ok",
      });
    } catch (err) {
      finishSpan({ storage: this.ctx.storage, logger: this.ctx.logger }, span, {
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
