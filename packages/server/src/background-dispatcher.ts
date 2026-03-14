import type { BackgroundJobSourceKind, BackgroundWaitingReason, PluginContext } from "@personal-ai/core";
import { getLlmTrafficConfig, getLlmTrafficSnapshot, upsertJob } from "@personal-ai/core";
import { createResearchJob, listPendingResearchJobs, runResearchInBackground } from "@personal-ai/plugin-research";
import { createSwarmJob, listPendingSwarmJobs, runSwarmInBackground } from "@personal-ai/plugin-swarm";
import { formatSearchResults, webSearch } from "@personal-ai/plugin-assistant/web-search";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";
import { enqueueBriefingGeneration, generateBriefing, listPendingDailyBriefings } from "./briefing.js";

type PendingKind = "research" | "swarm" | "briefing";

interface PendingWorkItem {
  id: string;
  kind: PendingKind;
  queuedAt: string;
  sourceKind: BackgroundJobSourceKind;
}

const SOURCE_PRIORITY: Record<BackgroundJobSourceKind, number> = {
  manual: 0,
  schedule: 1,
  maintenance: 2,
};

function compareWork(a: PendingWorkItem, b: PendingWorkItem): number {
  const aPriority = SOURCE_PRIORITY[a.sourceKind] ?? Number.MAX_SAFE_INTEGER;
  const bPriority = SOURCE_PRIORITY[b.sourceKind] ?? Number.MAX_SAFE_INTEGER;
  return aPriority - bPriority
    || Date.parse(a.queuedAt) - Date.parse(b.queuedAt)
    || a.id.localeCompare(b.id);
}

function sourceWaitingReason(sourceKind: BackgroundJobSourceKind): BackgroundWaitingReason {
  if (sourceKind === "manual") return "manual_job_ahead";
  if (sourceKind === "schedule") return "scheduled_job_ahead";
  return "maintenance_job_ahead";
}

export class BackgroundDispatcher {
  private startedAt = 0;
  private running = false;
  private activeWorkId: string | null = null;
  private activeKind: PendingKind | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: PluginContext) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.nudge();
  }

  stop(): void {
    this.running = false;
    this.activeWorkId = null;
    this.activeKind = null;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  nudge(delayMs = 0): void {
    if (!this.running) return;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.drain();
    }, Math.max(0, delayMs));
  }

  async enqueueResearch(args: {
    goal: string;
    threadId: string | null;
    resultType?: string;
    sourceKind?: BackgroundJobSourceKind;
    sourceScheduleId?: string | null;
  }): Promise<string> {
    const queuedAt = new Date().toISOString();
    const sourceKind = args.sourceKind ?? "manual";
    const jobId = createResearchJob(this.ctx.storage, {
      goal: args.goal,
      threadId: args.threadId,
      resultType: args.resultType as never,
      sourceKind,
      sourceScheduleId: args.sourceScheduleId ?? null,
    });
    upsertJob(this.ctx.storage, {
      id: jobId,
      type: "research",
      label: args.goal.slice(0, 100),
      status: "pending",
      progress: "queued",
      startedAt: queuedAt,
      queuedAt,
      attemptCount: 0,
      lastAttemptAt: null,
      sourceKind,
      sourceScheduleId: args.sourceScheduleId ?? null,
      resultType: args.resultType as never,
    });
    this.nudge();
    return jobId;
  }

  async enqueueSwarm(args: {
    goal: string;
    threadId: string | null;
    resultType?: string;
    sourceKind?: BackgroundJobSourceKind;
    sourceScheduleId?: string | null;
  }): Promise<string> {
    const queuedAt = new Date().toISOString();
    const sourceKind = args.sourceKind ?? "manual";
    const jobId = createSwarmJob(this.ctx.storage, {
      goal: args.goal,
      threadId: args.threadId,
      resultType: args.resultType,
      sourceKind,
      sourceScheduleId: args.sourceScheduleId ?? null,
    });
    upsertJob(this.ctx.storage, {
      id: jobId,
      type: "swarm",
      label: args.goal.slice(0, 100),
      status: "pending",
      progress: "queued",
      startedAt: queuedAt,
      queuedAt,
      attemptCount: 0,
      lastAttemptAt: null,
      sourceKind,
      sourceScheduleId: args.sourceScheduleId ?? null,
      resultType: args.resultType as never,
    });
    this.nudge();
    return jobId;
  }

  enqueueBriefing(args?: { sourceKind?: BackgroundJobSourceKind; reason?: string }): string {
    const id = enqueueBriefingGeneration(this.ctx.storage, args?.sourceKind ?? "maintenance");
    this.nudge();
    return id;
  }

  getWorkState(): {
    startupDelayUntil: number | null;
    activeWorkId: string | null;
    activeKind: PendingKind | null;
    pending: PendingWorkItem[];
  } {
    return {
      startupDelayUntil: this.startedAt > 0 ? this.startedAt + getLlmTrafficConfig().startupDelayMs : null,
      activeWorkId: this.activeWorkId,
      activeKind: this.activeKind,
      pending: this.getPendingWork(),
    };
  }

  getJobQueueMetadata(jobId: string): { queuePosition: number | null; waitingReason: BackgroundWaitingReason | null } {
    const state = this.getWorkState();
    const pending = state.pending;
    const index = pending.findIndex((item) => item.id === jobId);
    if (index === -1) return { queuePosition: null, waitingReason: null };
    if (state.startupDelayUntil && Date.now() < state.startupDelayUntil) {
      return { queuePosition: index + 1, waitingReason: "startup_delay" };
    }

    const traffic = getLlmTrafficSnapshot();
    if ((traffic.active.interactive + traffic.queued.interactive + traffic.active.deferred + traffic.queued.deferred) > 0) {
      return { queuePosition: index + 1, waitingReason: "interactive_ahead" };
    }

    if (index > 0) {
      return { queuePosition: index + 1, waitingReason: sourceWaitingReason(pending[index - 1]!.sourceKind) };
    }

    if (this.activeWorkId || traffic.active.background > 0) {
      return { queuePosition: 1, waitingReason: "llm_busy" };
    }

    return { queuePosition: 1, waitingReason: null };
  }

  private getPendingWork(): PendingWorkItem[] {
    const research = listPendingResearchJobs(this.ctx.storage).map((job) => ({
      id: job.id,
      kind: "research" as const,
      queuedAt: job.queuedAt,
      sourceKind: job.sourceKind,
    }));
    const swarm = listPendingSwarmJobs(this.ctx.storage).map((job) => ({
      id: job.id,
      kind: "swarm" as const,
      queuedAt: job.queuedAt,
      sourceKind: job.sourceKind,
    }));
    const briefings = listPendingDailyBriefings(this.ctx.storage).map((briefing) => ({
      id: briefing.id,
      kind: "briefing" as const,
      queuedAt: briefing.queuedAt,
      sourceKind: briefing.sourceKind,
    }));
    return [...research, ...swarm, ...briefings].sort(compareWork);
  }

  private hasInteractivePressure(): boolean {
    const traffic = getLlmTrafficSnapshot();
    return (traffic.active.interactive + traffic.queued.interactive + traffic.active.deferred + traffic.queued.deferred) > 0;
  }

  private async drain(): Promise<void> {
    if (!this.running || this.activeWorkId) return;

    const startupDelayUntil = this.startedAt + getLlmTrafficConfig().startupDelayMs;
    if (Date.now() < startupDelayUntil) {
      this.nudge(startupDelayUntil - Date.now());
      return;
    }

    if (this.hasInteractivePressure()) {
      this.nudge(500);
      return;
    }

    if (getLlmTrafficSnapshot().active.background > 0) {
      this.nudge(500);
      return;
    }

    const next = this.getPendingWork()[0];
    if (!next) return;

    this.activeWorkId = next.id;
    this.activeKind = next.kind;

    try {
      if (next.kind === "research") {
        await runResearchInBackground(this.buildResearchContext(), next.id);
      } else if (next.kind === "swarm") {
        await runSwarmInBackground(this.buildSwarmContext(), next.id);
      } else {
        await generateBriefing(this.ctx, undefined, next.id);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isTransient = /fetch failed|econnrefused|enotfound|econnreset|etimedout|cannot reach|rate limit|too many requests|429|503/i.test(errorMsg);

      // Check attempt count before retrying
      const attempts = this.ctx.storage.query<{ attempt_count: number }>(
        "SELECT attempt_count FROM background_jobs WHERE id = ?",
        [next.id],
      );
      const attemptCount = attempts[0]?.attempt_count ?? 0;

      if (isTransient && next.kind === "research" && attemptCount < 2) {
        // Re-queue the job after a delay instead of permanently failing (max 2 retries)
        this.ctx.logger.warn("Research job failed with transient error, will retry on next drain", {
          id: next.id,
          error: errorMsg,
          attempt: attemptCount + 1,
        });
        try {
          this.ctx.storage.run(
            "UPDATE research_jobs SET status = 'pending' WHERE id = ? AND status = 'failed'",
            [next.id],
          );
          this.ctx.storage.run(
            "UPDATE background_jobs SET status = 'pending', progress = 'retry after transient error', error = ? WHERE id = ? AND status = 'error'",
            [errorMsg, next.id],
          );
        } catch {
          // If re-queue fails, the job stays failed — that's fine
        }
      } else {
        this.ctx.logger.error("Background dispatch failed", {
          kind: next.kind,
          id: next.id,
          error: errorMsg,
        });
      }
    } finally {
      this.activeWorkId = null;
      this.activeKind = null;
      // Longer delay after transient failure to give LLM service time to recover
      this.nudge(500);
    }
  }

  private buildResearchContext() {
    return {
      storage: this.ctx.storage,
      llm: this.ctx.llm,
      logger: this.ctx.logger,
      timezone: this.ctx.config.timezone,
      provider: this.ctx.config.llm.provider,
      model: this.ctx.config.llm.model,
      contextWindow: this.ctx.config.llm.contextWindow,
      sandboxUrl: this.ctx.config.sandboxUrl,
      browserUrl: this.ctx.config.browserUrl,
      dataDir: this.ctx.config.dataDir,
      webSearch: (query: string, maxResults?: number) => webSearch(query, maxResults, "general", this.ctx.config.searchUrl),
      formatSearchResults,
      fetchPage: fetchPageAsMarkdown,
    };
  }

  private buildSwarmContext() {
    return {
      storage: this.ctx.storage,
      llm: this.ctx.llm,
      logger: this.ctx.logger,
      timezone: this.ctx.config.timezone,
      provider: this.ctx.config.llm.provider,
      model: this.ctx.config.llm.model,
      contextWindow: this.ctx.config.llm.contextWindow,
      sandboxUrl: this.ctx.config.sandboxUrl,
      browserUrl: this.ctx.config.browserUrl,
      dataDir: this.ctx.config.dataDir,
      webSearch: (query: string, maxResults?: number) => webSearch(query, maxResults, "general", this.ctx.config.searchUrl),
      formatSearchResults,
      fetchPage: fetchPageAsMarkdown,
    };
  }
}

export function attachBackgroundDispatch(ctx: PluginContext, dispatcher: BackgroundDispatcher): void {
  ctx.backgroundJobs = {
    enqueueResearch: (args) => dispatcher.enqueueResearch(args),
    enqueueSwarm: (args) => dispatcher.enqueueSwarm(args),
    enqueueBriefing: (args) => dispatcher.enqueueBriefing(args),
  };
}

export function buildQueueMetadata(
  dispatcher: BackgroundDispatcher,
  jobId: string,
): { queuePosition: number | null; waitingReason: BackgroundWaitingReason | null } {
  return dispatcher.getJobQueueMetadata(jobId);
}
