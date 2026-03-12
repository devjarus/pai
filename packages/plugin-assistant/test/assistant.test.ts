import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentContext } from "@personal-ai/core";
import { assistantPlugin } from "../src/index.js";

const { mockCreateProgram, mockListPrograms, mockDeleteProgram } = vi.hoisted(() => ({
  mockCreateProgram: vi.fn(),
  mockListPrograms: vi.fn().mockReturnValue([]),
  mockDeleteProgram: vi.fn(),
}));

vi.mock("@personal-ai/core", () => ({
  getMemoryContext: vi.fn(),
  remember: vi.fn(),
  listBeliefs: vi.fn().mockReturnValue([]),
  formatDateTime: vi.fn().mockReturnValue({ full: "Mar 12, 2026 09:00" }),
  resolveSandboxUrl: vi.fn().mockReturnValue(null),
  resolveBrowserUrl: vi.fn().mockReturnValue(null),
  createBrowserTools: vi.fn().mockReturnValue({}),
}));

vi.mock("@personal-ai/plugin-schedules", () => ({
  createProgram: mockCreateProgram,
  listPrograms: mockListPrograms,
  deleteProgram: mockDeleteProgram,
}));

vi.mock("@personal-ai/plugin-tasks", () => ({
  addTask: vi.fn().mockReturnValue({ id: "task_123", title: "Test", priority: "medium" }),
  listTasks: vi.fn().mockReturnValue([]),
  completeTask: vi.fn(),
}));

function createMockCtx(overrides?: Partial<AgentContext>): AgentContext {
  return {
    config: {} as any,
    storage: { db: "mock-storage" } as any,
    llm: { model: "mock-llm" } as any,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as any,
    userMessage: "test message for the assistant that is long enough",
    conversationHistory: [],
    ...overrides,
  } as AgentContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListPrograms.mockReturnValue([]);
});

describe("assistantPlugin structure", () => {
  it("has correct name and version", () => {
    expect(assistantPlugin.name).toBe("assistant");
    expect(assistantPlugin.version).toBe("0.2.0");
  });

  it("has empty migrations array", () => {
    expect(assistantPlugin.migrations).toEqual([]);
  });

  it("commands() returns empty array", () => {
    const cmds = assistantPlugin.commands({} as any);
    expect(cmds).toEqual([]);
  });

  it("has correct agent displayName and description", () => {
    expect(assistantPlugin.agent).toBeDefined();
    expect(assistantPlugin.agent!.displayName).toBe("Personal Assistant");
    expect(assistantPlugin.agent!.description).toContain("General-purpose assistant with persistent memory");
  });

  it("has capabilities ['general', 'memory', 'tasks', 'web-search']", () => {
    expect(assistantPlugin.agent!.capabilities).toEqual(["general", "memory", "tasks", "web-search"]);
  });

  it("has createTools function", () => {
    expect(assistantPlugin.agent!.createTools).toBeTypeOf("function");
  });

  it("does not have beforeResponse", () => {
    expect(assistantPlugin.agent!.beforeResponse).toBeUndefined();
  });
});

describe("createTools", () => {
  it("returns an object with expected tool names", () => {
    const ctx = createMockCtx();
    const tools = assistantPlugin.agent!.createTools!(ctx);

    expect(tools).toBeDefined();
    const toolNames = Object.keys(tools);
    expect(toolNames).toContain("memory_recall");
    expect(toolNames).toContain("memory_remember");
    expect(toolNames).toContain("memory_beliefs");
    expect(toolNames).toContain("memory_forget");
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("task_list");
    expect(toolNames).toContain("task_add");
    expect(toolNames).toContain("task_done");
    expect(toolNames).toContain("program_create");
    expect(toolNames).toContain("program_list");
    expect(toolNames).toContain("program_delete");
    expect(toolNames).not.toContain("schedule_create");
    expect(toolNames).not.toContain("schedule_list");
    expect(toolNames).not.toContain("schedule_delete");
  });

  it("returns 19 tools total", () => {
    const ctx = createMockCtx();
    const tools = assistantPlugin.agent!.createTools!(ctx);
    expect(Object.keys(tools)).toHaveLength(19);
  });

  it("each tool has description and execute function", () => {
    const ctx = createMockCtx();
    const tools = assistantPlugin.agent!.createTools!(ctx) as Record<string, any>;

    for (const [name, tool] of Object.entries(tools)) {
      expect(tool, `Tool ${name} should have description`).toHaveProperty("description");
      expect(tool, `Tool ${name} should have execute`).toHaveProperty("execute");
    }
  });

  it("system prompt uses Program language for recurring work", () => {
    const prompt = assistantPlugin.agent!.systemPrompt ?? "";
    expect(prompt).toContain("program_create");
    expect(prompt).toContain("keep watching this");
    expect(prompt).not.toContain("schedule_create");
  });

  it("program_create uses the Program adapter", async () => {
    mockCreateProgram.mockReturnValue({
      id: "prog_123",
      title: "Atlas launch readiness",
      executionMode: "analysis",
      intervalHours: 24,
      nextRunAt: "2026-03-12T16:00:00.000Z",
    });

    const ctx = createMockCtx({
      config: { timezone: "America/Los_Angeles" } as any,
    });
    const tools = assistantPlugin.agent!.createTools!(ctx) as Record<string, any>;

    const result = await tools.program_create.execute({
      title: "Atlas launch readiness",
      question: "Keep watching Atlas launch readiness and brief me when blockers change.",
      family: "work",
      execution_mode: "analysis",
      interval_hours: 24,
      preferences: ["prioritize blockers"],
      constraints: ["docs signoff required"],
    });

    expect(mockCreateProgram).toHaveBeenCalledWith(
      ctx.storage,
      expect.objectContaining({
        title: "Atlas launch readiness",
        question: "Keep watching Atlas launch readiness and brief me when blockers change.",
        family: "work",
        executionMode: "analysis",
        intervalHours: 24,
        preferences: ["prioritize blockers"],
        constraints: ["docs signoff required"],
      }),
    );
    expect(result).toContain("Program created");
  });

  it("program_create forwards thread and chat context from Ask", async () => {
    mockCreateProgram.mockReturnValue({
      id: "prog_234",
      title: "Atlas launch readiness",
      executionMode: "research",
      intervalHours: 24,
      nextRunAt: "2026-03-12T16:00:00.000Z",
    });

    const ctx = createMockCtx({
      config: { timezone: "America/Los_Angeles" } as any,
    });
    (ctx as unknown as Record<string, unknown>).threadId = "thread-123";
    (ctx as unknown as Record<string, unknown>).chatId = 42;

    const tools = assistantPlugin.agent!.createTools!(ctx) as Record<string, any>;
    await tools.program_create.execute({
      title: "Atlas launch readiness",
      question: "Keep watching Atlas launch readiness and brief me when blockers change.",
    });

    expect(mockCreateProgram).toHaveBeenCalledWith(
      ctx.storage,
      expect.objectContaining({
        threadId: "thread-123",
        chatId: 42,
      }),
    );
  });

  it("program_list returns Programs from the adapter", async () => {
    mockListPrograms.mockReturnValue([
      {
        id: "prog_123",
        title: "Atlas launch readiness",
        family: "work",
        executionMode: "research",
        question: "Keep watching Atlas launch readiness",
        intervalHours: 24,
        nextRunAt: "2026-03-12T16:00:00.000Z",
        lastRunAt: null,
      },
    ]);

    const ctx = createMockCtx();
    const tools = assistantPlugin.agent!.createTools!(ctx) as Record<string, any>;
    const result = await tools.program_list.execute({});

    expect(mockListPrograms).toHaveBeenCalledWith(ctx.storage, "active");
    expect(result).toEqual([
      expect.objectContaining({
        id: "prog_123",
        title: "Atlas launch readiness",
        family: "work",
      }),
    ]);
  });

  it("program_delete removes Programs through the adapter", async () => {
    mockDeleteProgram.mockReturnValue(true);

    const ctx = createMockCtx();
    const tools = assistantPlugin.agent!.createTools!(ctx) as Record<string, any>;
    const result = await tools.program_delete.execute({ id: "prog_123" });

    expect(mockDeleteProgram).toHaveBeenCalledWith(ctx.storage, "prog_123");
    expect(result).toBe("Program deleted.");
  });
});

describe("afterResponse", () => {
  const afterResponse = assistantPlugin.agent!.afterResponse!;

  it("skips extraction for short user messages", async () => {
    const ctx = createMockCtx({
      userMessage: "hi",
      llm: { chat: vi.fn() } as any,
    });
    await afterResponse(ctx, "Hello! How can I help you?");
    expect(ctx.llm.chat).not.toHaveBeenCalled();
  });

  it("skips extraction when assistant response is empty or very short", async () => {
    const ctx = createMockCtx({
      userMessage: "I really prefer TypeScript over JavaScript for all my projects",
      llm: { chat: vi.fn() } as any,
    });
    await afterResponse(ctx, "OK");
    expect(ctx.llm.chat).not.toHaveBeenCalled();
  });

  it("skips storage when assistant contradicted the user", async () => {
    const { remember: mockRemember } = await import("@personal-ai/core");
    const mockChat = vi.fn()
      // First call: extraction — returns a candidate fact
      .mockResolvedValueOnce({ text: "The user believes the moon is made of cheese" })
      // Second call: validation — assistant contradicted
      .mockResolvedValueOnce({ text: "REJECTED" });

    const ctx = createMockCtx({
      userMessage: "I heard the moon is made of cheese, isn't that cool?",
      llm: { chat: mockChat } as any,
    });

    await afterResponse(ctx, "Actually, the moon is not made of cheese. It's made of rock and dust.");

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockRemember).not.toHaveBeenCalled();
  });

  it("stores facts when assistant confirms or acknowledges", async () => {
    const { remember: mockRemember } = await import("@personal-ai/core");
    const mockChat = vi.fn()
      // First call: extraction
      .mockResolvedValueOnce({ text: "Alex prefers Vitest over Jest" })
      // Second call: validation — confirmed
      .mockResolvedValueOnce({ text: "CONFIRMED" });

    const ctx = createMockCtx({
      userMessage: "I prefer Vitest over Jest for all my TypeScript testing",
      llm: { chat: mockChat } as any,
    });

    await afterResponse(ctx, "Great choice! Vitest is excellent for TypeScript projects with its native support.");

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockRemember).toHaveBeenCalledTimes(1);
    expect(mockRemember).toHaveBeenCalledWith(
      ctx.storage,
      ctx.llm,
      "Alex prefers Vitest over Jest",
      ctx.logger,
    );
  });

  it("stores at most 3 facts per message", async () => {
    const { remember: mockRemember } = await import("@personal-ai/core");
    const mockChat = vi.fn()
      // First call: extraction — returns 5 candidate facts
      .mockResolvedValueOnce({
        text: "Alex likes React\nAlex uses TypeScript\nAlex prefers pnpm\nAlex uses Vitest\nAlex likes Tailwind",
      })
      // Validation calls — all confirmed
      .mockResolvedValueOnce({ text: "CONFIRMED" })
      .mockResolvedValueOnce({ text: "CONFIRMED" })
      .mockResolvedValueOnce({ text: "CONFIRMED" });

    const ctx = createMockCtx({
      userMessage: "I like React, use TypeScript, prefer pnpm, use Vitest, and like Tailwind for all my projects",
      llm: { chat: mockChat } as any,
    });

    await afterResponse(ctx, "Those are all great technology choices! They work really well together.");

    // 1 extraction + 3 validations = 4 calls (only first 3 facts validated)
    expect(mockChat).toHaveBeenCalledTimes(4);
    expect(mockRemember).toHaveBeenCalledTimes(3);
  });

  it("validation prompt includes assistant response and candidate fact", async () => {
    const mockChat = vi.fn()
      .mockResolvedValueOnce({ text: "Alex prefers dark mode" })
      .mockResolvedValueOnce({ text: "CONFIRMED" });

    const ctx = createMockCtx({
      userMessage: "I always use dark mode in all my editors and apps",
      llm: { chat: mockChat } as any,
    });

    const assistantResponse = "Dark mode is great for reducing eye strain!";
    await afterResponse(ctx, assistantResponse);

    // Check the validation call (second call) includes both the fact and assistant response
    const validationCall = mockChat.mock.calls[1];
    const validationMessages = validationCall[0];
    const systemContent = validationMessages.find((m: any) => m.role === "system")?.content ?? "";
    const userContent = validationMessages.find((m: any) => m.role === "user")?.content ?? "";

    expect(systemContent + userContent).toContain("Alex prefers dark mode");
    expect(systemContent + userContent).toContain(assistantResponse);
  });
});
