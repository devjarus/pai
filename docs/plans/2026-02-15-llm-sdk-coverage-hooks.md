# LLM SDK Migration, Coverage & Git Hooks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hand-rolled fetch LLM client with Vercel AI SDK (token tracking built-in), raise test coverage above thresholds, and add git hooks for quality gates.

**Architecture:** The `LLMClient` interface in core/types.ts gains a `usage` return type. `createLLMClient` in core/llm.ts is rewritten to use `ai` + `@ai-sdk/openai` + `ollama-ai-provider-v2`. The interface stays the same for consumers (plugins call `llm.chat()`), but now returns usage metadata. Tests mock at the AI SDK level. Husky pre-commit runs lint-staged; pre-push runs verify.

**Tech Stack:** `ai` (Vercel AI SDK), `@ai-sdk/openai`, `ollama-ai-provider-v2`, `husky`, `lint-staged`

---

### Task 1: Install Vercel AI SDK dependencies

**Files:**
- Modify: `packages/core/package.json`

**Step 1: Install AI SDK packages into core**

Run:
```bash
pnpm --filter @personal-ai/core add ai @ai-sdk/openai ollama-ai-provider-v2
```

**Step 2: Verify install**

Run: `pnpm --filter @personal-ai/core ls ai @ai-sdk/openai ollama-ai-provider-v2`
Expected: All three listed as dependencies.

**Step 3: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "deps: add Vercel AI SDK (ai, @ai-sdk/openai, ollama-ai-provider-v2)"
```

---

### Task 2: Update LLMClient interface to include token usage

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/test/llm.test.ts`

**Step 1: Write the failing test**

Add to `packages/core/test/llm.test.ts`:

```typescript
it("chat should return text and usage", async () => {
  const client = createLLMClient({
    provider: "openai",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    fallbackMode: "strict",
  });
  // Type check: result must have text and usage
  type ChatResult = Awaited<ReturnType<typeof client.chat>>;
  type AssertText = ChatResult extends { text: string } ? true : never;
  type AssertUsage = ChatResult extends { usage: { inputTokens?: number; outputTokens?: number } } ? true : never;
  const _t: AssertText = true;
  const _u: AssertUsage = true;
  expect(_t).toBe(true);
  expect(_u).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/test/llm.test.ts`
Expected: FAIL — `chat` returns `Promise<string>`, not an object.

**Step 3: Update the interface in types.ts**

Replace in `packages/core/src/types.ts`:

```typescript
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  text: string;
  usage: TokenUsage;
}

export interface LLMClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  health(): Promise<{ ok: boolean; provider: string }>;
}
```

**Step 4: Run test to verify it passes (type-level)**

This will cause compile errors in consumers — that's expected. The test itself should pass the type check now. Other tests will break (fixed in Task 3).

**Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/test/llm.test.ts
git commit -m "feat(core): add TokenUsage and ChatResult to LLMClient interface"
```

---

### Task 3: Rewrite createLLMClient with Vercel AI SDK

**Files:**
- Modify: `packages/core/src/llm.ts`
- Test: `packages/core/test/llm.test.ts`

**Step 1: Write failing tests for chat and health with mocked fetch**

Replace entire `packages/core/test/llm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLLMClient } from "../src/llm.js";

describe("LLMClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should construct with ollama config", () => {
    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf("function");
    expect(client.health).toBeTypeOf("function");
  });

  it("should construct with openai config", () => {
    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });
    expect(client).toBeDefined();
  });

  it("chat should return text and usage via openai provider", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello world" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });

    const result = await client.chat([{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("Hello world");
    expect(result.usage).toBeDefined();
  });

  it("chat should return text and usage via ollama provider", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "Ollama says hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });

    const result = await client.chat([{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("Ollama says hi");
    expect(result.usage).toBeDefined();
  });

  it("health should return ok for openai", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai");
  });

  it("health should return ok for ollama", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("ollama");
  });

  it("health should return not ok on fetch failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });
    const result = await client.health();
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/core/test/llm.test.ts`
Expected: FAIL — current implementation returns `string` not `ChatResult`.

**Step 3: Rewrite llm.ts**

Replace entire `packages/core/src/llm.ts`:

```typescript
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import type { LLMClient, ChatMessage, ChatOptions, ChatResult, Config } from "./types.js";

export function createLLMClient(llmConfig: Config["llm"]): LLMClient {
  const { provider, model, baseUrl, apiKey } = llmConfig;

  const llmModel =
    provider === "ollama"
      ? createOllama({ baseURL: `${baseUrl}/api` })(model)
      : createOpenAI({ baseURL: baseUrl, apiKey: apiKey ?? "" })(model);

  async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const { text, usage } = await generateText({
      model: llmModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      maxTokens: options?.maxTokens,
    });

    return {
      text,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      },
    };
  }

  async function health(): Promise<{ ok: boolean; provider: string }> {
    try {
      if (provider === "ollama") {
        const res = await fetch(`${baseUrl}/api/tags`);
        return { ok: res.ok, provider: "ollama" };
      }
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { ok: res.ok, provider: "openai" };
    } catch {
      return { ok: false, provider };
    }
  }

  return { chat, health };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/core/test/llm.test.ts`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add packages/core/src/llm.ts packages/core/test/llm.test.ts
git commit -m "feat(core): rewrite LLM client with Vercel AI SDK + token tracking"
```

---

### Task 4: Update consumers to use ChatResult

**Files:**
- Modify: `packages/plugin-memory/src/remember.ts`
- Modify: `packages/plugin-tasks/src/index.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/plugin-memory/test/remember.test.ts`

**Step 1: Update remember.ts — extractBelief returns text from ChatResult**

In `packages/plugin-memory/src/remember.ts`, change:

```typescript
export async function extractBelief(llm: LLMClient, text: string): Promise<string> {
  const result = await llm.chat([
    {
      role: "system",
      content:
        "Extract a single, concise belief or lesson from the following observation. " +
        "Reply with ONLY the belief statement, nothing else. Keep it under 20 words.",
    },
    { role: "user", content: text },
  ], { temperature: 0.3 });
  return result.text;
}
```

**Step 2: Update tasks/index.ts — aiSuggest returns text from ChatResult**

In `packages/plugin-tasks/src/index.ts`, change `aiSuggest` last line:

```typescript
  const result = await llm.chat([...], );
  return result.text;
```

(The `llm.chat(...)` call stays identical, just destructure `.text` from the result.)

**Step 3: Update remember.test.ts mock to return ChatResult**

In `packages/plugin-memory/test/remember.test.ts`, change the mock:

```typescript
const mockLLM: LLMClient = {
  chat: vi.fn().mockResolvedValue({
    text: "TypeScript strict mode catches more bugs at compile time",
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
  health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
};
```

**Step 4: Run all tests**

Run: `pnpm test`
Expected: All tests PASS (16+).

**Step 5: Commit**

```bash
git add packages/plugin-memory/src/remember.ts packages/plugin-tasks/src/index.ts packages/plugin-memory/test/remember.test.ts
git commit -m "refactor: update all LLM consumers to use ChatResult"
```

---

### Task 5: Add tests for remember() full flow and reinforceBelief

**Files:**
- Modify: `packages/plugin-memory/test/remember.test.ts`
- Modify: `packages/plugin-memory/test/memory.test.ts`

**Step 1: Add remember() integration tests**

Append to `packages/plugin-memory/test/remember.test.ts`:

```typescript
import { createStorage } from "@personal-ai/core";
import { memoryMigrations, searchBeliefs } from "../src/memory.js";
import { remember } from "../src/remember.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("remember", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-rem-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should create episode and new belief", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "Testing is valuable",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    const result = await remember(storage, mockLLM, "I wrote tests and found bugs");
    expect(result.episodeId).toBeDefined();
    expect(result.beliefId).toBeDefined();
    expect(result.isReinforcement).toBe(false);
  });

  it("should reinforce existing belief on similar input", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        text: "Testing is valuable",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };

    // First call creates the belief
    await remember(storage, mockLLM, "Tests caught bugs");
    // Second call should reinforce
    const result = await remember(storage, mockLLM, "Tests caught more bugs");
    expect(result.isReinforcement).toBe(true);
  });
});
```

**Step 2: Add reinforceBelief test to memory.test.ts**

Append to the `describe("Memory", ...)` block in `packages/plugin-memory/test/memory.test.ts`:

```typescript
import { reinforceBelief } from "../src/memory.js";

// Inside describe:
it("should reinforce belief and increase confidence", () => {
  const belief = createBelief(storage, { statement: "test belief", confidence: 0.5 });
  reinforceBelief(storage, belief.id);
  const beliefs = listBeliefs(storage);
  expect(beliefs[0]!.confidence).toBeCloseTo(0.6);
});

it("should cap reinforced belief confidence at 1.0", () => {
  const belief = createBelief(storage, { statement: "strong belief", confidence: 0.95 });
  reinforceBelief(storage, belief.id, 0.2);
  const beliefs = listBeliefs(storage);
  expect(beliefs[0]!.confidence).toBeLessThanOrEqual(1.0);
});
```

**Step 3: Run tests**

Run: `pnpm test`
Expected: All tests PASS.

**Step 4: Run coverage**

Run: `pnpm run test:coverage`
Check that memory.ts, remember.ts, and llm.ts coverage have all improved significantly.

**Step 5: Commit**

```bash
git add packages/plugin-memory/test/remember.test.ts packages/plugin-memory/test/memory.test.ts
git commit -m "test: add remember() integration tests and reinforceBelief coverage"
```

---

### Task 6: Raise coverage thresholds

**Files:**
- Modify: `vitest.config.ts`

**Step 1: Run coverage and note actual numbers**

Run: `pnpm run test:coverage`
Note the actual percentages from the report.

**Step 2: Update thresholds to match actuals minus 5% buffer**

In `vitest.config.ts`, update thresholds based on actual coverage. Target raising them significantly from the current 55/75/60/55. Expected new values will be around 80/75/85/80 after the new tests.

**Step 3: Run coverage to verify thresholds pass**

Run: `pnpm run test:coverage`
Expected: PASS with new thresholds.

**Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: raise coverage thresholds after test improvements"
```

---

### Task 7: Add git hooks via Husky + lint-staged

**Files:**
- Modify: `package.json` (root)
- Create: `.husky/pre-commit`
- Create: `.husky/pre-push`

**Step 1: Install husky and lint-staged**

Run:
```bash
pnpm -w add -D husky lint-staged
```

**Step 2: Initialize husky**

Run:
```bash
npx husky init
```

This creates `.husky/` directory and adds `"prepare": "husky"` to package.json.

**Step 3: Create pre-commit hook**

Write `.husky/pre-commit`:

```bash
pnpm exec lint-staged
```

**Step 4: Create pre-push hook**

Write `.husky/pre-push`:

```bash
pnpm run verify
```

**Step 5: Add lint-staged config to root package.json**

Add to root `package.json`:

```json
"lint-staged": {
  "packages/*/src/**/*.ts": [
    "eslint --fix"
  ]
}
```

**Step 6: Test pre-commit hook**

Run:
```bash
git add -A && git stash  # clean state
echo "// test" >> packages/core/src/config.ts
git add packages/core/src/config.ts
pnpm exec lint-staged  # should run eslint on the staged file
git checkout packages/core/src/config.ts  # restore
git stash pop
```

**Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml .husky/
git commit -m "chore: add husky pre-commit (lint-staged) and pre-push (verify) hooks"
```

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Key changes:
- Remove "Currently in pre-implementation phase" from overview
- Add coverage commands to Build & Test section: `pnpm run test:coverage`, `pnpm run verify`, `pnpm run ci`
- Add `ai`, `@ai-sdk/openai`, `ollama-ai-provider-v2` to Tech Stack
- Add Git Hooks section explaining pre-commit (lint-staged) and pre-push (verify)
- Add Coverage section explaining thresholds and how to check

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with coverage, hooks, and AI SDK info"
```

---

### Task 9: Final verification

**Step 1: Full CI pipeline**

Run: `pnpm run ci`
Expected: typecheck PASS, tests PASS, coverage PASS with thresholds met.

**Step 2: Verify hooks work**

Run: `git log --oneline -10` to confirm all commits landed cleanly.
