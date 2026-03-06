import { AsyncLocalStorage } from "node:async_hooks";
import type { LlmTrafficConfig, LlmTrafficLane } from "./types.js";

export interface LlmTrafficPermit {
  lane: LlmTrafficLane;
  queueWaitMs: number;
  queueDepthAtEnqueue: number;
  queueDepthAtStart: number;
  release(): void;
}

export interface LlmTrafficSnapshot {
  active: Record<LlmTrafficLane, number>;
  queued: Record<LlmTrafficLane, number>;
  activeTotal: number;
  queuedTotal: number;
}

interface QueueRequest {
  lane: LlmTrafficLane;
  enqueuedAt: number;
  queueDepthAtEnqueue: number;
  resolve: (permit: LlmTrafficPermit) => void;
}

interface PermitContext {
  lane: LlmTrafficLane;
}

const LANE_ORDER: LlmTrafficLane[] = ["interactive", "deferred", "background"];
const permitContext = new AsyncLocalStorage<PermitContext>();

const DEFAULTS: Required<LlmTrafficConfig> = {
  maxConcurrent: 6,
  startGapMs: 1500,
  startupDelayMs: 10000,
  swarmAgentConcurrency: 5,
  reservedInteractiveSlots: 1,
};

export function getDefaultLlmTrafficConfig(): Required<LlmTrafficConfig> {
  return { ...DEFAULTS };
}

class LlmTrafficController {
  private config = { ...DEFAULTS };
  private queues: Record<LlmTrafficLane, QueueRequest[]> = {
    interactive: [],
    deferred: [],
    background: [],
  };
  private active: Record<LlmTrafficLane, number> = {
    interactive: 0,
    deferred: 0,
    background: 0,
  };
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBackgroundStartAt = 0;

  configure(config?: LlmTrafficConfig): void {
    const maxConcurrent = Math.max(1, config?.maxConcurrent ?? DEFAULTS.maxConcurrent);
    this.config = {
      ...DEFAULTS,
      ...(config ?? {}),
      maxConcurrent,
      startGapMs: Math.max(0, config?.startGapMs ?? DEFAULTS.startGapMs),
      startupDelayMs: Math.max(0, config?.startupDelayMs ?? DEFAULTS.startupDelayMs),
      swarmAgentConcurrency: Math.max(1, config?.swarmAgentConcurrency ?? DEFAULTS.swarmAgentConcurrency),
      reservedInteractiveSlots: Math.max(0, Math.min(
        maxConcurrent - 1,
        config?.reservedInteractiveSlots ?? DEFAULTS.reservedInteractiveSlots,
      )),
    };
    this.scheduleDrain(0);
  }

  getConfig(): Required<LlmTrafficConfig> {
    return { ...this.config };
  }

  snapshot(): LlmTrafficSnapshot {
    const queued = {
      interactive: this.queues.interactive.length,
      deferred: this.queues.deferred.length,
      background: this.queues.background.length,
    };
    const active = { ...this.active };
    return {
      active,
      queued,
      activeTotal: active.interactive + active.deferred + active.background,
      queuedTotal: queued.interactive + queued.deferred + queued.background,
    };
  }

  async acquire(lane: LlmTrafficLane): Promise<LlmTrafficPermit> {
    const current = permitContext.getStore();
    if (current) {
      return {
        lane,
        queueWaitMs: 0,
        queueDepthAtEnqueue: 0,
        queueDepthAtStart: 0,
        release: () => {},
      };
    }

    return new Promise<LlmTrafficPermit>((resolve) => {
      const snapshot = this.snapshot();
      const request: QueueRequest = {
        lane,
        enqueuedAt: Date.now(),
        queueDepthAtEnqueue: snapshot.queued[lane] + snapshot.active[lane],
        resolve,
      };
      this.queues[lane].push(request);
      this.scheduleDrain(0);
    });
  }

  private release(lane: LlmTrafficLane): void {
    this.active[lane] = Math.max(0, this.active[lane] - 1);
    this.scheduleDrain(0);
  }

  private scheduleDrain(delayMs: number): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, Math.max(0, delayMs));
  }

  private drain(): void {
    while (true) {
      const next = this.nextRequest();
      if (!next) return;
      if (!this.canStartLane(next.lane)) return;

      const now = Date.now();
      if (next.lane === "background" && this.config.startGapMs > 0) {
        const gapRemaining = this.lastBackgroundStartAt + this.config.startGapMs - now;
        if (gapRemaining > 0) {
          this.scheduleDrain(gapRemaining);
          return;
        }
      }

      this.queues[next.lane].shift();
      this.active[next.lane] += 1;
      if (next.lane === "background") {
        this.lastBackgroundStartAt = now;
      }

      const queueWaitMs = Math.max(0, now - next.enqueuedAt);
      const permit: LlmTrafficPermit = {
        lane: next.lane,
        queueWaitMs,
        queueDepthAtEnqueue: next.queueDepthAtEnqueue,
        queueDepthAtStart: this.active[next.lane] + this.queues[next.lane].length - 1,
        release: () => {
          if ((permit as { released?: boolean }).released) return;
          (permit as { released?: boolean }).released = true;
          this.release(next.lane);
        },
      };
      next.resolve(permit);
    }
  }

  private canStartLane(lane: LlmTrafficLane): boolean {
    const snapshot = this.snapshot();
    if (lane !== "background") {
      return snapshot.activeTotal < this.config.maxConcurrent;
    }

    const backgroundCapacity = Math.max(1, this.config.maxConcurrent - this.config.reservedInteractiveSlots);
    return snapshot.activeTotal < backgroundCapacity;
  }

  private nextRequest(): QueueRequest | null {
    for (const lane of LANE_ORDER) {
      const queue = this.queues[lane];
      if (queue.length > 0) return queue[0]!;
    }
    return null;
  }
}

const controller = new LlmTrafficController();

function wrapIteratorWithPermitContext<T>(iterable: AsyncIterable<T>, lane: LlmTrafficLane): AsyncIterable<T> {
  if (permitContext.getStore()) return iterable;

  return {
    [Symbol.asyncIterator]() {
      const iterator = iterable[Symbol.asyncIterator]();
      return {
        next: () => permitContext.run({ lane }, () => iterator.next()),
        return: (value?: unknown) => iterator.return
          ? permitContext.run({ lane }, () => iterator.return!(value as never))
          : Promise.resolve({ done: true, value } as IteratorResult<T>),
        throw: (error?: unknown) => iterator.throw
          ? permitContext.run({ lane }, () => iterator.throw!(error))
          : Promise.reject(error),
      };
    },
  };
}

export function configureLlmTraffic(config?: LlmTrafficConfig): void {
  controller.configure(config);
}

export function acquireLlmTrafficPermit(lane: LlmTrafficLane): Promise<LlmTrafficPermit> {
  return controller.acquire(lane);
}

export function runWithLlmTrafficPermitContext<T>(permit: LlmTrafficPermit, fn: () => Promise<T>): Promise<T> {
  if (permitContext.getStore()) return fn();
  return permitContext.run({ lane: permit.lane }, fn);
}

export function runWithLlmTrafficPermitContextStream<T>(permit: LlmTrafficPermit, iterable: AsyncIterable<T>): AsyncIterable<T> {
  return wrapIteratorWithPermitContext(iterable, permit.lane);
}

export function getLlmTrafficSnapshot(): LlmTrafficSnapshot {
  return controller.snapshot();
}

export function getLlmTrafficConfig(): Required<LlmTrafficConfig> {
  return controller.getConfig();
}

export function getTrafficLane(process: string, surface?: string | null): LlmTrafficLane {
  if (
    process === "chat.main" ||
    process === "chat.subagent" ||
    process === "telegram.chat"
  ) {
    return "interactive";
  }

  if (
    process === "thread.title" ||
    process === "memory.extract" ||
    process === "memory.relationship" ||
    process === "memory.summarize" ||
    process === "telegram.passive"
  ) {
    return "deferred";
  }

  if (
    process === "research.run" ||
    process === "swarm.plan" ||
    process === "swarm.agent" ||
    process === "swarm.synthesize" ||
    process === "briefing.generate" ||
    process === "learning.extract"
  ) {
    return "background";
  }

  if (process === "embed.memory" || process === "embed.knowledge") {
    return surface === "worker" ? "background" : "deferred";
  }

  return surface === "worker" ? "background" : "interactive";
}
