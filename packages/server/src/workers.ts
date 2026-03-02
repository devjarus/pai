import type { PluginContext } from "@personal-ai/core";
import { cleanupExpiredSources } from "@personal-ai/core";
import { getDueSchedules, markScheduleRun } from "@personal-ai/plugin-schedules";
import { createResearchJob, runResearchInBackground } from "@personal-ai/plugin-research";
import { webSearch, formatSearchResults } from "@personal-ai/plugin-assistant/web-search";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";
import { generateBriefing, getLatestBriefing } from "./briefing.js";
import { runBackgroundLearning } from "./learning.js";

export interface WorkerOptions {
  briefingIntervalMs?: number;
  scheduleCheckIntervalMs?: number;
  learningIntervalMs?: number;
  learningInitialDelayMs?: number;
  knowledgeCleanupIntervalMs?: number;
  generateInitialBriefing?: boolean;
}

const DEFAULT_BRIEFING_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_LEARNING_INTERVAL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_LEARNING_INITIAL_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_KNOWLEDGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class WorkerLoop {
  private briefingTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private learningInitTimer: ReturnType<typeof setTimeout> | null = null;
  private learningTimer: ReturnType<typeof setInterval> | null = null;
  private knowledgeCleanupTimer: ReturnType<typeof setInterval> | null = null;
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

    const briefingMs = this.options?.briefingIntervalMs ?? DEFAULT_BRIEFING_INTERVAL_MS;
    const scheduleMs = this.options?.scheduleCheckIntervalMs ?? DEFAULT_SCHEDULE_CHECK_INTERVAL_MS;
    const learningMs = this.options?.learningIntervalMs ?? DEFAULT_LEARNING_INTERVAL_MS;
    const learningDelayMs = this.options?.learningInitialDelayMs ?? DEFAULT_LEARNING_INITIAL_DELAY_MS;
    const generateInitial = this.options?.generateInitialBriefing ?? true;

    // --- Briefing generator ---
    this.briefingTimer = setInterval(() => {
      if (this.ctx.config.workers?.briefing === false) return;
      generateBriefing(this.ctx).catch((err) => {
        this.ctx.logger.warn(`Background briefing failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, briefingMs);

    if (generateInitial && this.ctx.config.workers?.briefing !== false) {
      const latest = getLatestBriefing(this.ctx.storage);
      if (!latest) {
        generateBriefing(this.ctx).catch((err) => {
          this.ctx.logger.warn(`Initial briefing failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    // --- Schedule runner ---
    this.scheduleCheckTimer = setInterval(() => {
      this.runDueSchedules().catch(() => {});
    }, scheduleMs);

    // --- Background learning ---
    this.learningInitTimer = setTimeout(() => {
      if (this.ctx.config.workers?.backgroundLearning === false) return;
      runBackgroundLearning(this.ctx, this.abortController.signal).catch((err) => {
        this.ctx.logger.warn(`Background learning failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, learningDelayMs);

    this.learningTimer = setInterval(() => {
      if (this.ctx.config.workers?.backgroundLearning === false) return;
      runBackgroundLearning(this.ctx, this.abortController.signal).catch((err) => {
        this.ctx.logger.warn(`Background learning failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, learningMs);

    // --- Knowledge cleanup ---
    const knowledgeCleanupMs = this.options?.knowledgeCleanupIntervalMs ?? DEFAULT_KNOWLEDGE_CLEANUP_INTERVAL_MS;
    this.knowledgeCleanupTimer = setInterval(() => {
      if (this.ctx.config.workers?.knowledgeCleanup === false) return;
      try {
        const defaultTtlDays = this.ctx.config.knowledge?.defaultTtlDays ?? 90;
        const result = cleanupExpiredSources(this.ctx.storage, { defaultTtlDays });
        if (result.deleted > 0) {
          this.ctx.logger.info(`Knowledge cleanup: deleted ${result.deleted} expired source(s)`);
        }
      } catch (err) {
        this.ctx.logger.warn(`Knowledge cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, knowledgeCleanupMs);
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
  }

  updateContext(newCtx: Partial<PluginContext>): void {
    Object.assign(this.ctx, newCtx);
  }

  private async runDueSchedules(): Promise<void> {
    try {
      const due = getDueSchedules(this.ctx.storage);
      for (const schedule of due) {
        this.ctx.logger.info("Running scheduled job", { id: schedule.id, label: schedule.label });
        markScheduleRun(this.ctx.storage, schedule.id);

        if (schedule.type === "research") {
          const jobId = createResearchJob(this.ctx.storage, {
            goal: schedule.goal,
            threadId: schedule.threadId,
          });
          runResearchInBackground(
            {
              storage: this.ctx.storage,
              llm: this.ctx.llm,
              logger: this.ctx.logger,
              timezone: this.ctx.config.timezone,
              provider: this.ctx.config.llm.provider,
              model: this.ctx.config.llm.model,
              contextWindow: this.ctx.config.llm.contextWindow,
              webSearch,
              formatSearchResults,
              fetchPage: fetchPageAsMarkdown,
            },
            jobId,
          ).catch((err) => {
            this.ctx.logger.error(`Scheduled research failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }
    } catch (err) {
      this.ctx.logger.warn(`Schedule runner error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
