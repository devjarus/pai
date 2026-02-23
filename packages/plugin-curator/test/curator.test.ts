import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentContext } from "@personal-ai/core";
import { curatorPlugin } from "../src/index.js";

vi.mock("@personal-ai/core", async () => {
  const actual = await vi.importActual("@personal-ai/core");
  return {
    ...actual,
    memoryStats: vi.fn().mockReturnValue({
      beliefs: { total: 50, active: 40, invalidated: 5, forgotten: 5 },
      episodes: 100,
      avgConfidence: 0.7,
      oldestBelief: "2026-01-01",
      newestBelief: "2026-02-22",
    }),
    reflect: vi.fn().mockReturnValue({
      duplicates: [{ ids: ["a", "b"], statements: ["stmt1", "stmt2"], similarity: 0.9 }],
      stale: [{ id: "c", statement: "old stmt", effectiveConfidence: 0.03 }],
      total: 40,
    }),
    findContradictions: vi.fn().mockResolvedValue([]),
    mergeDuplicates: vi.fn().mockReturnValue({ merged: 1, kept: ["a"] }),
    pruneBeliefs: vi.fn().mockReturnValue(["c"]),
    synthesize: vi.fn().mockResolvedValue({ metaBeliefs: ["Pattern found"], clustersProcessed: 1 }),
    forgetBelief: vi.fn(),
    listBeliefs: vi.fn().mockReturnValue([
      { id: "x1", statement: "Test belief", confidence: 0.8, status: "active", type: "factual", subject: "owner" },
    ]),
  };
});

function createMockCtx(overrides?: Partial<AgentContext>): AgentContext {
  return {
    config: {} as any,
    storage: { query: vi.fn().mockReturnValue([]) } as any,
    llm: { chat: vi.fn(), embed: vi.fn() } as any,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as any,
    userMessage: "check my memory health",
    conversationHistory: [],
    ...overrides,
  } as AgentContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("curatorPlugin structure", () => {
  it("has correct name and version", () => {
    expect(curatorPlugin.name).toBe("curator");
    expect(curatorPlugin.version).toBe("0.1.0");
  });

  it("has agent metadata", () => {
    expect(curatorPlugin.agent.displayName).toBe("Memory Curator");
    expect(curatorPlugin.agent.capabilities).toContain("memory-maintenance");
  });

  it("commands() returns empty array", () => {
    expect(curatorPlugin.commands({} as any)).toEqual([]);
  });
});

describe("createTools", () => {
  it("returns exactly 3 tools", () => {
    const ctx = createMockCtx();
    const tools = curatorPlugin.agent.createTools!(ctx);
    const names = Object.keys(tools);
    expect(names).toEqual(["curate_memory", "fix_issues", "list_beliefs"]);
  });

  it("curate_memory returns analysis report", async () => {
    const ctx = createMockCtx();
    const tools = curatorPlugin.agent.createTools!(ctx) as any;
    const result = await tools.curate_memory.execute({});
    expect(result.stats).toBeDefined();
    expect(result.duplicates).toHaveLength(1);
    expect(result.stale).toHaveLength(1);
    expect(result.contradictions).toBeDefined();
  });

  it("fix_issues with merge action calls mergeDuplicates", async () => {
    const { mergeDuplicates } = await import("@personal-ai/core");
    const ctx = createMockCtx();
    const tools = curatorPlugin.agent.createTools!(ctx) as any;
    const result = await tools.fix_issues.execute({
      action: "merge",
      beliefIds: ["a", "b"],
    });
    expect(mergeDuplicates).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("fix_issues with prune action calls pruneBeliefs", async () => {
    const { pruneBeliefs } = await import("@personal-ai/core");
    const ctx = createMockCtx();
    const tools = curatorPlugin.agent.createTools!(ctx) as any;
    const result = await tools.fix_issues.execute({
      action: "prune",
      threshold: 0.1,
    });
    expect(pruneBeliefs).toHaveBeenCalledWith(ctx.storage, 0.1);
    expect(result.ok).toBe(true);
  });

  it("fix_issues with resolve action calls forgetBelief", async () => {
    const { forgetBelief } = await import("@personal-ai/core");
    const ctx = createMockCtx();
    const tools = curatorPlugin.agent.createTools!(ctx) as any;
    const result = await tools.fix_issues.execute({
      action: "resolve",
      keepId: "a",
      removeId: "b",
    });
    expect(forgetBelief).toHaveBeenCalledWith(ctx.storage, "b");
    expect(result.ok).toBe(true);
  });

  it("fix_issues with synthesize action calls synthesize", async () => {
    const { synthesize } = await import("@personal-ai/core");
    const ctx = createMockCtx();
    const tools = curatorPlugin.agent.createTools!(ctx) as any;
    const result = await tools.fix_issues.execute({ action: "synthesize" });
    expect(synthesize).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("list_beliefs returns filtered beliefs", async () => {
    const { listBeliefs } = await import("@personal-ai/core");
    const ctx = createMockCtx();
    const tools = curatorPlugin.agent.createTools!(ctx) as any;
    const result = await tools.list_beliefs.execute({ status: "active" });
    expect(listBeliefs).toHaveBeenCalledWith(ctx.storage, "active");
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Test belief");
  });
});
