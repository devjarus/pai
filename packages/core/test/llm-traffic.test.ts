import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireLlmTrafficPermit,
  configureLlmTraffic,
  getDefaultLlmTrafficConfig,
  getLlmTrafficSnapshot,
} from "../src/index.js";
import { runWithLlmTrafficPermitContext } from "../src/llm-traffic.js";

describe("LlmTrafficController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    configureLlmTraffic(getDefaultLlmTrafficConfig());
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    configureLlmTraffic(getDefaultLlmTrafficConfig());
  });

  it("enforces single concurrency and prioritizes interactive work over background work", async () => {
    configureLlmTraffic({ maxConcurrent: 1, startGapMs: 0 });

    const backgroundPermitPromise = acquireLlmTrafficPermit("background");
    await vi.runAllTimersAsync();
    const backgroundPermit = await backgroundPermitPromise;

    const queuedBackgroundPromise = acquireLlmTrafficPermit("background");
    const interactivePromise = acquireLlmTrafficPermit("interactive");

    await vi.runAllTimersAsync();
    const snapshotWhileBusy = getLlmTrafficSnapshot();
    expect(snapshotWhileBusy.activeTotal).toBe(1);
    expect(snapshotWhileBusy.queued.background).toBe(1);
    expect(snapshotWhileBusy.queued.interactive).toBe(1);

    backgroundPermit.release();
    await vi.runAllTimersAsync();

    const interactivePermit = await interactivePromise;
    const snapshotAfterInteractiveStart = getLlmTrafficSnapshot();
    expect(snapshotAfterInteractiveStart.active.interactive).toBe(1);
    expect(snapshotAfterInteractiveStart.queued.background).toBe(1);

    interactivePermit.release();
    await vi.runAllTimersAsync();

    const queuedBackgroundPermit = await queuedBackgroundPromise;
    expect(getLlmTrafficSnapshot().active.background).toBe(1);
    queuedBackgroundPermit.release();
    await vi.runAllTimersAsync();
    expect(getLlmTrafficSnapshot().activeTotal).toBe(0);
  });

  it("preserves FIFO order within a lane", async () => {
    configureLlmTraffic({ maxConcurrent: 1, startGapMs: 0 });

    const firstInteractive = await (async () => {
      const permit = acquireLlmTrafficPermit("interactive");
      await vi.runAllTimersAsync();
      return permit;
    })();

    const resolutionOrder: string[] = [];
    const backgroundOne = acquireLlmTrafficPermit("background").then((permit) => {
      resolutionOrder.push("background-one");
      return permit;
    });
    const backgroundTwo = acquireLlmTrafficPermit("background").then((permit) => {
      resolutionOrder.push("background-two");
      return permit;
    });

    firstInteractive.release();
    await vi.runAllTimersAsync();

    const firstBackground = await backgroundOne;
    expect(resolutionOrder).toEqual(["background-one"]);

    firstBackground.release();
    await vi.runAllTimersAsync();

    const secondBackground = await backgroundTwo;
    expect(resolutionOrder).toEqual(["background-one", "background-two"]);
    secondBackground.release();
  });

  it("stagger starts for background work using startGapMs", async () => {
    configureLlmTraffic({ maxConcurrent: 1, startGapMs: 1500 });

    const firstBackground = await (async () => {
      const permit = acquireLlmTrafficPermit("background");
      await vi.runAllTimersAsync();
      return permit;
    })();

    let secondResolved = false;
    const secondBackgroundPromise = acquireLlmTrafficPermit("background").then((permit) => {
      secondResolved = true;
      return permit;
    });

    firstBackground.release();
    await vi.advanceTimersByTimeAsync(1499);
    expect(secondResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const secondBackground = await secondBackgroundPromise;
    expect(secondResolved).toBe(true);
    expect(secondBackground.queueWaitMs).toBeGreaterThanOrEqual(1500);
    secondBackground.release();
  });

  it("reserves interactive capacity from background work", async () => {
    configureLlmTraffic({ maxConcurrent: 2, reservedInteractiveSlots: 1, startGapMs: 0 });

    const firstBackground = await (async () => {
      const permit = acquireLlmTrafficPermit("background");
      await vi.runAllTimersAsync();
      return permit;
    })();

    let secondBackgroundResolved = false;
    const secondBackgroundPromise = acquireLlmTrafficPermit("background").then((permit) => {
      secondBackgroundResolved = true;
      return permit;
    });

    await vi.runAllTimersAsync();
    expect(secondBackgroundResolved).toBe(false);

    const interactivePromise = acquireLlmTrafficPermit("interactive");
    await vi.runAllTimersAsync();
    const interactivePermit = await interactivePromise;
    expect(getLlmTrafficSnapshot().active.interactive).toBe(1);
    expect(secondBackgroundResolved).toBe(false);

    interactivePermit.release();
    await vi.runAllTimersAsync();
    expect(secondBackgroundResolved).toBe(false);

    firstBackground.release();
    await vi.runAllTimersAsync();
    const secondBackground = await secondBackgroundPromise;
    expect(secondBackgroundResolved).toBe(true);
    secondBackground.release();
  });

  it("reuses the active permit for nested interactive work", async () => {
    configureLlmTraffic({ maxConcurrent: 1, startGapMs: 0 });

    const permit = await (async () => {
      const pending = acquireLlmTrafficPermit("interactive");
      await vi.runAllTimersAsync();
      return pending;
    })();

    await runWithLlmTrafficPermitContext(permit, async () => {
      const nested = await acquireLlmTrafficPermit("interactive");
      expect(nested.queueWaitMs).toBe(0);
      expect(getLlmTrafficSnapshot().activeTotal).toBe(1);
      nested.release();
      expect(getLlmTrafficSnapshot().activeTotal).toBe(1);
    });

    permit.release();
    await vi.runAllTimersAsync();
    expect(getLlmTrafficSnapshot().activeTotal).toBe(0);
  });
});
