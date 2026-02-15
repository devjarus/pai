# Personal AI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a minimal personal AI with plugin architecture — core + memory plugin + tasks plugin, CLI-first.

**Architecture:** pnpm monorepo with 4 packages: `core` (config, storage, LLM client, plugin interface), `cli` (entrypoint that loads plugins), `plugin-memory` (episodes + beliefs), `plugin-tasks` (tasks + goals). Single SQLite database, Ollama-first LLM.

**Tech Stack:** TypeScript strict, Node.js 20+, pnpm workspaces, better-sqlite3 + FTS5, Commander.js, Vitest, Zod, Ollama/OpenAI

---

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json` (workspace root)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/plugin-memory/package.json`
- Create: `packages/plugin-memory/tsconfig.json`
- Create: `packages/plugin-tasks/package.json`
- Create: `packages/plugin-tasks/tsconfig.json`

**Step 1: Create workspace root**

```json
// package.json
{
  "name": "personal-ai",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "test:watch": "pnpm -r run test:watch",
    "lint": "eslint packages/*/src",
    "typecheck": "pnpm -r run typecheck",
    "pai": "node packages/cli/dist/index.js"
  },
  "engines": { "node": ">=20.0.0" }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

```
# .nvmrc
20
```

```gitignore
# .gitignore
node_modules/
dist/
coverage/
*.db
*.db-journal
.env
```

**Step 2: Create package skeletons**

Each package gets the same shape:

```json
// packages/core/package.json
{
  "name": "@personal-ai/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0"
  }
}
```

```json
// packages/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts"]
}
```

```json
// packages/cli/package.json
{
  "name": "@personal-ai/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "pai": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@personal-ai/core": "workspace:*",
    "@personal-ai/plugin-memory": "workspace:*",
    "@personal-ai/plugin-tasks": "workspace:*",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

```json
// packages/plugin-memory/package.json
{
  "name": "@personal-ai/plugin-memory",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@personal-ai/core": "workspace:*",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0"
  }
}
```

```json
// packages/plugin-tasks/package.json
{
  "name": "@personal-ai/plugin-tasks",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@personal-ai/core": "workspace:*",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0"
  }
}
```

Plugin tsconfig files follow the same pattern as core (extends base, outDir dist, rootDir src).

**Step 3: Install dependencies**

Run: `cd /Users/suraj-devloper/workspace/personal-ai && pnpm install`

**Step 4: Verify structure**

Run: `pnpm -r ls --depth 0`
Expected: All 4 packages listed

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with 4 packages"
```

---

### Task 2: Core — Types & Config

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/config.ts`
- Test: `packages/core/test/config.test.ts`

**Step 1: Write the types**

```typescript
// packages/core/src/types.ts
import type { Database, RunResult } from "better-sqlite3";

export interface Config {
  dataDir: string;
  llm: {
    provider: "ollama" | "openai";
    model: string;
    baseUrl: string;
    apiKey?: string;
    fallbackMode: "local-first" | "strict";
  };
  plugins: string[];
}

export interface Migration {
  version: number;
  up: string; // SQL statement
}

export interface Storage {
  db: Database;
  migrate(pluginName: string, migrations: Migration[]): void;
  query<T>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): RunResult;
  close(): void;
}

export interface LLMClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  health(): Promise<{ ok: boolean; provider: string }>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface PluginContext {
  config: Config;
  storage: Storage;
  llm: LLMClient;
}

export interface Command {
  name: string;
  description: string;
  args?: Array<{ name: string; description: string; required?: boolean }>;
  options?: Array<{ flags: string; description: string; defaultValue?: string }>;
  action: (args: Record<string, string>, opts: Record<string, string>) => Promise<void>;
}

export interface Plugin {
  name: string;
  version: string;
  migrations: Migration[];
  commands(ctx: PluginContext): Command[];
}
```

**Step 2: Write the failing config test**

```typescript
// packages/core/test/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("should return defaults when no env vars set", () => {
    const config = loadConfig({});
    expect(config.dataDir).toContain("personal-ai");
    expect(config.llm.provider).toBe("ollama");
    expect(config.llm.model).toBe("llama3.2");
    expect(config.llm.baseUrl).toBe("http://127.0.0.1:11434");
    expect(config.llm.fallbackMode).toBe("local-first");
    expect(config.plugins).toEqual(["memory", "tasks"]);
  });

  it("should override from env", () => {
    const config = loadConfig({
      PAI_DATA_DIR: "/tmp/test-pai",
      PAI_LLM_PROVIDER: "openai",
      PAI_LLM_MODEL: "gpt-4.1-mini",
      PAI_LLM_BASE_URL: "https://api.openai.com/v1",
      PAI_LLM_API_KEY: "sk-test",
      PAI_PLUGINS: "memory",
    });
    expect(config.dataDir).toBe("/tmp/test-pai");
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4.1-mini");
    expect(config.llm.apiKey).toBe("sk-test");
    expect(config.plugins).toEqual(["memory"]);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/suraj-devloper/workspace/personal-ai && pnpm --filter @personal-ai/core test`
Expected: FAIL — module not found

**Step 4: Write config implementation**

```typescript
// packages/core/src/config.ts
import { join } from "node:path";
import { homedir } from "node:os";
import type { Config } from "./types.js";

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    dataDir: env["PAI_DATA_DIR"] ?? join(homedir(), ".personal-ai"),
    llm: {
      provider: (env["PAI_LLM_PROVIDER"] as Config["llm"]["provider"]) ?? "ollama",
      model: env["PAI_LLM_MODEL"] ?? "llama3.2",
      baseUrl: env["PAI_LLM_BASE_URL"] ?? "http://127.0.0.1:11434",
      apiKey: env["PAI_LLM_API_KEY"],
      fallbackMode:
        (env["PAI_LLM_FALLBACK_MODE"] as Config["llm"]["fallbackMode"]) ?? "local-first",
    },
    plugins: env["PAI_PLUGINS"]?.split(",").map((s) => s.trim()) ?? ["memory", "tasks"],
  };
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @personal-ai/core test`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/config.ts packages/core/test/config.test.ts
git commit -m "feat(core): add types and config with env-based loading"
```

---

### Task 3: Core — Storage

**Files:**
- Create: `packages/core/src/storage.ts`
- Test: `packages/core/test/storage.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/test/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "../src/storage.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Migration } from "../src/types.js";

describe("Storage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should create database file", () => {
    const storage = createStorage(dir);
    expect(storage.db.open).toBe(true);
    storage.close();
  });

  it("should run migrations", () => {
    const storage = createStorage(dir);
    const migrations: Migration[] = [
      { version: 1, up: "CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)" },
    ];
    storage.migrate("test-plugin", migrations);
    storage.run("INSERT INTO test (id, value) VALUES (?, ?)", ["1", "hello"]);
    const rows = storage.query<{ id: string; value: string }>("SELECT * FROM test");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("hello");
    storage.close();
  });

  it("should skip already-applied migrations", () => {
    const storage = createStorage(dir);
    const migrations: Migration[] = [
      { version: 1, up: "CREATE TABLE test2 (id TEXT PRIMARY KEY)" },
    ];
    storage.migrate("test-plugin", migrations);
    // Running again should not throw
    storage.migrate("test-plugin", migrations);
    storage.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/core test`
Expected: FAIL — createStorage not found

**Step 3: Write storage implementation**

```typescript
// packages/core/src/storage.ts
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Storage, Migration } from "./types.js";

export function createStorage(dataDir: string): Storage {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "personal-ai.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      plugin TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (plugin, version)
    )
  `);

  return {
    db,

    migrate(pluginName: string, migrations: Migration[]): void {
      const applied = db
        .prepare("SELECT version FROM _migrations WHERE plugin = ?")
        .all(pluginName) as Array<{ version: number }>;
      const appliedVersions = new Set(applied.map((r) => r.version));

      for (const m of migrations) {
        if (appliedVersions.has(m.version)) continue;
        db.exec(m.up);
        db.prepare("INSERT INTO _migrations (plugin, version) VALUES (?, ?)").run(
          pluginName,
          m.version,
        );
      }
    },

    query<T>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },

    run(sql: string, params: unknown[] = []) {
      return db.prepare(sql).run(...params);
    },

    close(): void {
      db.close();
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @personal-ai/core test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/storage.ts packages/core/test/storage.test.ts
git commit -m "feat(core): add SQLite storage with migration tracking"
```

---

### Task 4: Core — LLM Client

**Files:**
- Create: `packages/core/src/llm.ts`
- Test: `packages/core/test/llm.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/test/llm.test.ts
import { describe, it, expect, vi } from "vitest";
import { createLLMClient } from "../src/llm.js";

// We test with a mock fetch — real Ollama tests are integration tests
describe("LLMClient", () => {
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
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/core test`
Expected: FAIL — createLLMClient not found

**Step 3: Write LLM client implementation**

```typescript
// packages/core/src/llm.ts
import type { LLMClient, ChatMessage, ChatOptions, Config } from "./types.js";

export function createLLMClient(llmConfig: Config["llm"]): LLMClient {
  const { provider, model, baseUrl, apiKey } = llmConfig;

  async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    if (provider === "ollama") {
      return chatOllama(baseUrl, model, messages, options);
    }
    return chatOpenAI(baseUrl, model, apiKey ?? "", messages, options);
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

async function chatOllama(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { message: { content: string } };
  return data.message.content;
}

async function chatOpenAI(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]!.message.content;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @personal-ai/core test`
Expected: PASS

**Step 5: Create core index**

```typescript
// packages/core/src/index.ts
export type {
  Config, Migration, Storage, LLMClient, ChatMessage, ChatOptions,
  PluginContext, Command, Plugin,
} from "./types.js";
export { loadConfig } from "./config.js";
export { createStorage } from "./storage.js";
export { createLLMClient } from "./llm.js";
```

**Step 6: Commit**

```bash
git add packages/core/src/llm.ts packages/core/src/index.ts packages/core/test/llm.test.ts
git commit -m "feat(core): add LLM client (Ollama + OpenAI) and core index"
```

---

### Task 5: Memory Plugin — Schema & CRUD

**Files:**
- Create: `packages/plugin-memory/src/index.ts`
- Create: `packages/plugin-memory/src/memory.ts`
- Test: `packages/plugin-memory/test/memory.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/plugin-memory/test/memory.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import { memoryMigrations, createEpisode, listEpisodes, createBelief, searchBeliefs, listBeliefs, linkBeliefToEpisode } from "../src/memory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Memory", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-mem-"));
    storage = createStorage(dir);
    storage.migrate("memory", memoryMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should create and list episodes", () => {
    createEpisode(storage, { context: "testing", action: "wrote a test", outcome: "passed" });
    const episodes = listEpisodes(storage);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.action).toBe("wrote a test");
  });

  it("should create and search beliefs", () => {
    createBelief(storage, { statement: "TypeScript is better than JavaScript for large projects", confidence: 0.8 });
    createBelief(storage, { statement: "SQLite is great for local-first apps", confidence: 0.9 });
    const results = searchBeliefs(storage, "SQLite local");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.statement).toContain("SQLite");
  });

  it("should list active beliefs", () => {
    createBelief(storage, { statement: "test belief", confidence: 0.5 });
    const beliefs = listBeliefs(storage);
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]!.status).toBe("active");
  });

  it("should link belief to episode", () => {
    const ep = createEpisode(storage, { context: "test", action: "observed", outcome: "learned" });
    const belief = createBelief(storage, { statement: "observation is useful", confidence: 0.6 });
    linkBeliefToEpisode(storage, belief.id, ep.id);
    // No error = success
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: FAIL — modules not found

**Step 3: Write memory implementation**

```typescript
// packages/plugin-memory/src/memory.ts
import type { Storage, Migration } from "@personal-ai/core";
import { nanoid } from "nanoid";

export const memoryMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE episodes (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        context TEXT,
        action TEXT NOT NULL,
        outcome TEXT,
        tags_json TEXT DEFAULT '[]'
      );
      CREATE TABLE beliefs (
        id TEXT PRIMARY KEY,
        statement TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE belief_episodes (
        belief_id TEXT NOT NULL REFERENCES beliefs(id),
        episode_id TEXT NOT NULL REFERENCES episodes(id),
        PRIMARY KEY (belief_id, episode_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS beliefs_fts USING fts5(statement, content=beliefs, content_rowid=rowid);
      CREATE TRIGGER beliefs_ai AFTER INSERT ON beliefs BEGIN
        INSERT INTO beliefs_fts(rowid, statement) VALUES (new.rowid, new.statement);
      END;
      CREATE TRIGGER beliefs_ad AFTER DELETE ON beliefs BEGIN
        INSERT INTO beliefs_fts(beliefs_fts, rowid, statement) VALUES ('delete', old.rowid, old.statement);
      END;
      CREATE TRIGGER beliefs_au AFTER UPDATE ON beliefs BEGIN
        INSERT INTO beliefs_fts(beliefs_fts, rowid, statement) VALUES ('delete', old.rowid, old.statement);
        INSERT INTO beliefs_fts(rowid, statement) VALUES (new.rowid, new.statement);
      END;
    `,
  },
];

export interface Episode {
  id: string;
  timestamp: string;
  context: string | null;
  action: string;
  outcome: string | null;
  tags_json: string;
}

export interface Belief {
  id: string;
  statement: string;
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export function createEpisode(
  storage: Storage,
  input: { context?: string; action: string; outcome?: string; tags?: string[] },
): Episode {
  const id = nanoid();
  storage.run(
    "INSERT INTO episodes (id, context, action, outcome, tags_json) VALUES (?, ?, ?, ?, ?)",
    [id, input.context ?? null, input.action, input.outcome ?? null, JSON.stringify(input.tags ?? [])],
  );
  return storage.query<Episode>("SELECT * FROM episodes WHERE id = ?", [id])[0]!;
}

export function listEpisodes(storage: Storage, limit = 50): Episode[] {
  return storage.query<Episode>("SELECT * FROM episodes ORDER BY timestamp DESC LIMIT ?", [limit]);
}

export function createBelief(
  storage: Storage,
  input: { statement: string; confidence: number },
): Belief {
  const id = nanoid();
  storage.run("INSERT INTO beliefs (id, statement, confidence) VALUES (?, ?, ?)", [
    id,
    input.statement,
    input.confidence,
  ]);
  return storage.query<Belief>("SELECT * FROM beliefs WHERE id = ?", [id])[0]!;
}

export function searchBeliefs(storage: Storage, query: string, limit = 10): Belief[] {
  return storage.query<Belief>(
    `SELECT b.* FROM beliefs b
     JOIN beliefs_fts fts ON b.rowid = fts.rowid
     WHERE beliefs_fts MATCH ? AND b.status = 'active'
     ORDER BY rank LIMIT ?`,
    [query, limit],
  );
}

export function listBeliefs(storage: Storage, status = "active"): Belief[] {
  return storage.query<Belief>(
    "SELECT * FROM beliefs WHERE status = ? ORDER BY confidence DESC",
    [status],
  );
}

export function linkBeliefToEpisode(storage: Storage, beliefId: string, episodeId: string): void {
  storage.run("INSERT OR IGNORE INTO belief_episodes (belief_id, episode_id) VALUES (?, ?)", [
    beliefId,
    episodeId,
  ]);
}

export function reinforceBelief(storage: Storage, beliefId: string, delta = 0.1): void {
  storage.run(
    "UPDATE beliefs SET confidence = MIN(1.0, confidence + ?), updated_at = datetime('now') WHERE id = ?",
    [delta, beliefId],
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/plugin-memory/src/memory.ts packages/plugin-memory/test/memory.test.ts
git commit -m "feat(plugin-memory): add episode and belief CRUD with FTS5 search"
```

---

### Task 6: Memory Plugin — LLM-Powered Remember & Plugin Export

**Files:**
- Create: `packages/plugin-memory/src/remember.ts`
- Modify: `packages/plugin-memory/src/index.ts`
- Test: `packages/plugin-memory/test/remember.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/plugin-memory/test/remember.test.ts
import { describe, it, expect, vi } from "vitest";
import { extractBelief } from "../src/remember.js";
import type { LLMClient } from "@personal-ai/core";

describe("extractBelief", () => {
  it("should extract a belief from episode text using LLM", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue("TypeScript strict mode catches more bugs at compile time"),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBelief(mockLLM, "Switched to TypeScript strict mode and found 12 hidden bugs");
    expect(result).toBe("TypeScript strict mode catches more bugs at compile time");
    expect(mockLLM.chat).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: FAIL — extractBelief not found

**Step 3: Write remember implementation**

```typescript
// packages/plugin-memory/src/remember.ts
import type { LLMClient, Storage } from "@personal-ai/core";
import { createEpisode, createBelief, searchBeliefs, reinforceBelief, linkBeliefToEpisode } from "./memory.js";

export async function extractBelief(llm: LLMClient, text: string): Promise<string> {
  return llm.chat([
    {
      role: "system",
      content:
        "Extract a single, concise belief or lesson from the following observation. " +
        "Reply with ONLY the belief statement, nothing else. Keep it under 20 words.",
    },
    { role: "user", content: text },
  ], { temperature: 0.3 });
}

export async function remember(
  storage: Storage,
  llm: LLMClient,
  text: string,
): Promise<{ episodeId: string; beliefId: string; isReinforcement: boolean }> {
  // 1. Create episode
  const episode = createEpisode(storage, { action: text });

  // 2. Extract belief via LLM
  const statement = await extractBelief(llm, text);

  // 3. Check for existing similar belief
  const existing = searchBeliefs(storage, statement, 1);
  if (existing.length > 0 && existing[0]!.confidence > 0) {
    // Reinforce existing belief
    reinforceBelief(storage, existing[0]!.id);
    linkBeliefToEpisode(storage, existing[0]!.id, episode.id);
    return { episodeId: episode.id, beliefId: existing[0]!.id, isReinforcement: true };
  }

  // 4. Create new belief
  const belief = createBelief(storage, { statement, confidence: 0.6 });
  linkBeliefToEpisode(storage, belief.id, episode.id);
  return { episodeId: episode.id, beliefId: belief.id, isReinforcement: false };
}
```

**Step 4: Write plugin index (exports Plugin interface)**

```typescript
// packages/plugin-memory/src/index.ts
import type { Plugin, PluginContext, Command } from "@personal-ai/core";
import { memoryMigrations, listEpisodes, listBeliefs, searchBeliefs } from "./memory.js";
import { remember } from "./remember.js";

export const memoryPlugin: Plugin = {
  name: "memory",
  version: "0.1.0",
  migrations: memoryMigrations,

  commands(ctx: PluginContext): Command[] {
    return [
      {
        name: "memory remember",
        description: "Record an observation and extract a belief",
        args: [{ name: "text", description: "What you observed or learned", required: true }],
        async action(args) {
          const result = await remember(ctx.storage, ctx.llm, args["text"]!);
          const label = result.isReinforcement ? "Reinforced existing" : "New";
          console.log(`${label} belief (${result.beliefId})`);
        },
      },
      {
        name: "memory recall",
        description: "Search beliefs by text",
        args: [{ name: "query", description: "Search query", required: true }],
        async action(args) {
          const beliefs = searchBeliefs(ctx.storage, args["query"]!);
          if (beliefs.length === 0) {
            console.log("No matching beliefs found.");
            return;
          }
          for (const b of beliefs) {
            console.log(`[${b.confidence.toFixed(1)}] ${b.statement}`);
          }
        },
      },
      {
        name: "memory beliefs",
        description: "List all active beliefs",
        options: [{ flags: "--status <status>", description: "Filter by status", defaultValue: "active" }],
        async action(_args, opts) {
          const beliefs = listBeliefs(ctx.storage, opts["status"]);
          if (beliefs.length === 0) {
            console.log("No beliefs found.");
            return;
          }
          for (const b of beliefs) {
            console.log(`[${b.confidence.toFixed(1)}] ${b.statement}`);
          }
        },
      },
      {
        name: "memory episodes",
        description: "List recent episodes",
        options: [{ flags: "--limit <n>", description: "Max episodes", defaultValue: "20" }],
        async action(_args, opts) {
          const episodes = listEpisodes(ctx.storage, parseInt(opts["limit"] ?? "20", 10));
          if (episodes.length === 0) {
            console.log("No episodes found.");
            return;
          }
          for (const ep of episodes) {
            console.log(`[${ep.timestamp}] ${ep.action}`);
          }
        },
      },
    ];
  },
};

export { memoryMigrations } from "./memory.js";
```

**Step 5: Run all tests**

Run: `pnpm --filter @personal-ai/plugin-memory test`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/plugin-memory/src/ packages/plugin-memory/test/
git commit -m "feat(plugin-memory): add LLM-powered remember and plugin export"
```

---

### Task 7: Tasks Plugin

**Files:**
- Create: `packages/plugin-tasks/src/tasks.ts`
- Create: `packages/plugin-tasks/src/index.ts`
- Test: `packages/plugin-tasks/test/tasks.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/plugin-tasks/test/tasks.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import { taskMigrations, addTask, listTasks, completeTask, addGoal, listGoals } from "../src/tasks.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Tasks", () => {
  let storage: ReturnType<typeof createStorage>;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pai-tasks-"));
    storage = createStorage(dir);
    storage.migrate("tasks", taskMigrations);
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should add and list tasks", () => {
    addTask(storage, { title: "Write tests" });
    addTask(storage, { title: "Ship feature" });
    const tasks = listTasks(storage);
    expect(tasks).toHaveLength(2);
  });

  it("should complete a task", () => {
    const task = addTask(storage, { title: "Do thing" });
    completeTask(storage, task.id);
    const tasks = listTasks(storage);
    expect(tasks).toHaveLength(0); // completed tasks not in open list
  });

  it("should add and list goals", () => {
    const goal = addGoal(storage, { title: "Launch personal AI" });
    addTask(storage, { title: "Write core", goalId: goal.id });
    addTask(storage, { title: "Write plugins", goalId: goal.id });
    const goals = listGoals(storage);
    expect(goals).toHaveLength(1);
    expect(goals[0]!.title).toBe("Launch personal AI");
  });

  it("should support task priority", () => {
    addTask(storage, { title: "Low priority", priority: "low" });
    addTask(storage, { title: "High priority", priority: "high" });
    const tasks = listTasks(storage);
    expect(tasks[0]!.title).toBe("High priority"); // high first
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @personal-ai/plugin-tasks test`
Expected: FAIL

**Step 3: Write tasks implementation**

```typescript
// packages/plugin-tasks/src/tasks.ts
import type { Storage, Migration } from "@personal-ai/core";
import { nanoid } from "nanoid";

export const taskMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'medium',
        goal_id TEXT REFERENCES goals(id),
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
    `,
  },
];

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  goal_id: string | null;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function addTask(
  storage: Storage,
  input: { title: string; description?: string; priority?: string; goalId?: string; dueDate?: string },
): Task {
  const id = nanoid();
  storage.run(
    "INSERT INTO tasks (id, title, description, priority, goal_id, due_date) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.title, input.description ?? null, input.priority ?? "medium", input.goalId ?? null, input.dueDate ?? null],
  );
  return storage.query<Task>("SELECT * FROM tasks WHERE id = ?", [id])[0]!;
}

export function listTasks(storage: Storage, status = "open"): Task[] {
  const tasks = storage.query<Task>("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC", [status]);
  return tasks.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));
}

export function completeTask(storage: Storage, taskId: string): void {
  storage.run("UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?", [taskId]);
}

export function addGoal(storage: Storage, input: { title: string; description?: string }): Goal {
  const id = nanoid();
  storage.run("INSERT INTO goals (id, title, description) VALUES (?, ?, ?)", [
    id,
    input.title,
    input.description ?? null,
  ]);
  return storage.query<Goal>("SELECT * FROM goals WHERE id = ?", [id])[0]!;
}

export function listGoals(storage: Storage): Goal[] {
  return storage.query<Goal>("SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC");
}
```

**Step 4: Write plugin index**

```typescript
// packages/plugin-tasks/src/index.ts
import type { Plugin, PluginContext, Command, LLMClient, Storage } from "@personal-ai/core";
import { taskMigrations, addTask, listTasks, completeTask, addGoal, listGoals } from "./tasks.js";

async function aiSuggest(storage: Storage, llm: LLMClient): Promise<string> {
  const tasks = listTasks(storage);
  const goals = listGoals(storage);

  if (tasks.length === 0) return "No open tasks. Add some with `pai task add`.";

  const taskList = tasks.map((t) => `- [${t.priority}] ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ""}`).join("\n");
  const goalList = goals.map((g) => `- ${g.title}`).join("\n");

  return llm.chat([
    {
      role: "system",
      content: "You are a productivity assistant. Given the user's tasks and goals, suggest what to work on next and why. Be concise (3-4 sentences max).",
    },
    {
      role: "user",
      content: `My goals:\n${goalList || "(none set)"}\n\nMy open tasks:\n${taskList}\n\nWhat should I focus on next?`,
    },
  ]);
}

export const tasksPlugin: Plugin = {
  name: "tasks",
  version: "0.1.0",
  migrations: taskMigrations,

  commands(ctx: PluginContext): Command[] {
    return [
      {
        name: "task add",
        description: "Add a new task",
        args: [{ name: "title", description: "Task title", required: true }],
        options: [
          { flags: "--priority <priority>", description: "low, medium, high", defaultValue: "medium" },
          { flags: "--goal <goalId>", description: "Link to goal ID" },
          { flags: "--due <date>", description: "Due date (YYYY-MM-DD)" },
        ],
        async action(args, opts) {
          const task = addTask(ctx.storage, {
            title: args["title"]!,
            priority: opts["priority"],
            goalId: opts["goal"],
            dueDate: opts["due"],
          });
          console.log(`Task added: ${task.id} — ${task.title}`);
        },
      },
      {
        name: "task list",
        description: "List open tasks",
        async action() {
          const tasks = listTasks(ctx.storage);
          if (tasks.length === 0) { console.log("No open tasks."); return; }
          for (const t of tasks) {
            const due = t.due_date ? ` (due: ${t.due_date})` : "";
            console.log(`  ${t.id.slice(0, 8)}  [${t.priority}]  ${t.title}${due}`);
          }
        },
      },
      {
        name: "task done",
        description: "Mark a task as complete",
        args: [{ name: "id", description: "Task ID (or prefix)", required: true }],
        async action(args) {
          completeTask(ctx.storage, args["id"]!);
          console.log("Task completed.");
        },
      },
      {
        name: "goal add",
        description: "Add a new goal",
        args: [{ name: "title", description: "Goal title", required: true }],
        async action(args) {
          const goal = addGoal(ctx.storage, { title: args["title"]! });
          console.log(`Goal added: ${goal.id} — ${goal.title}`);
        },
      },
      {
        name: "goal list",
        description: "List active goals",
        async action() {
          const goals = listGoals(ctx.storage);
          if (goals.length === 0) { console.log("No active goals."); return; }
          for (const g of goals) {
            console.log(`  ${g.id.slice(0, 8)}  ${g.title}`);
          }
        },
      },
      {
        name: "task ai-suggest",
        description: "Get AI-powered task prioritization",
        async action() {
          const suggestion = await aiSuggest(ctx.storage, ctx.llm);
          console.log(suggestion);
        },
      },
    ];
  },
};

export { taskMigrations } from "./tasks.js";
```

**Step 5: Run tests**

Run: `pnpm --filter @personal-ai/plugin-tasks test`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/plugin-tasks/src/ packages/plugin-tasks/test/
git commit -m "feat(plugin-tasks): add tasks and goals with AI suggest"
```

---

### Task 8: CLI Entrypoint

**Files:**
- Create: `packages/cli/src/index.ts`
- Test: manual smoke test

**Step 1: Write CLI entrypoint**

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, createStorage, createLLMClient } from "@personal-ai/core";
import type { Plugin, PluginContext } from "@personal-ai/core";
import { memoryPlugin } from "@personal-ai/plugin-memory";
import { tasksPlugin } from "@personal-ai/plugin-tasks";

const program = new Command();
program.name("pai").description("Personal AI — your local-first assistant").version("0.1.0");

const plugins: Record<string, Plugin> = {
  memory: memoryPlugin,
  tasks: tasksPlugin,
};

async function main(): Promise<void> {
  const config = loadConfig();
  const storage = createStorage(config.dataDir);
  const llm = createLLMClient(config.llm);

  const ctx: PluginContext = { config, storage, llm };

  // Load and migrate active plugins
  for (const name of config.plugins) {
    const plugin = plugins[name];
    if (!plugin) {
      console.error(`Unknown plugin: ${name}`);
      continue;
    }
    storage.migrate(plugin.name, plugin.migrations);

    // Register plugin commands
    for (const cmd of plugin.commands(ctx)) {
      const parts = cmd.name.split(" ");
      let parent = program;

      // Handle subcommands like "memory remember" or "task add"
      if (parts.length === 2) {
        const groupName = parts[0]!;
        let group = program.commands.find((c) => c.name() === groupName);
        if (!group) {
          group = program.command(groupName).description(`${groupName} commands`);
        }
        parent = group;
      }

      const sub = parent.command(parts[parts.length - 1]!).description(cmd.description);

      for (const arg of cmd.args ?? []) {
        if (arg.required) {
          sub.argument(`<${arg.name}>`, arg.description);
        } else {
          sub.argument(`[${arg.name}]`, arg.description);
        }
      }

      for (const opt of cmd.options ?? []) {
        sub.option(opt.flags, opt.description, opt.defaultValue);
      }

      sub.action(async (...actionArgs: unknown[]) => {
        try {
          // Commander passes positional args first, then opts object, then the Command
          const cmdObj = actionArgs[actionArgs.length - 1] as { opts: () => Record<string, string> };
          const opts = cmdObj.opts();
          const argValues: Record<string, string> = {};
          const argDefs = cmd.args ?? [];
          for (let i = 0; i < argDefs.length; i++) {
            argValues[argDefs[i]!.name] = actionArgs[i] as string;
          }
          await cmd.action(argValues, opts);
        } catch (err) {
          console.error("Error:", err instanceof Error ? err.message : err);
          process.exitCode = 1;
        }
      });
    }
  }

  // Health check command (built-in)
  program
    .command("health")
    .description("Check LLM provider health")
    .action(async () => {
      const result = await llm.health();
      console.log(`Provider: ${result.provider}`);
      console.log(`Status: ${result.ok ? "OK" : "UNAVAILABLE"}`);
      if (!result.ok) process.exitCode = 1;
    });

  await program.parseAsync(process.argv);
  storage.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Build all packages**

Run: `cd /Users/suraj-devloper/workspace/personal-ai && pnpm -r run build`
Expected: Clean build, no errors

**Step 3: Smoke test**

Run: `node packages/cli/dist/index.js --help`
Expected: Shows help with memory, task, goal, health commands

Run: `node packages/cli/dist/index.js task add "Test the CLI"`
Expected: `Task added: <id> — Test the CLI`

Run: `node packages/cli/dist/index.js task list`
Expected: Shows the task we just added

Run: `node packages/cli/dist/index.js task done <id-prefix>`
Expected: `Task completed.`

**Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add CLI entrypoint with plugin loading"
```

---

### Task 9: Final Polish

**Files:**
- Create: `README.md`
- Create: `.env.example`
- Create: `AGENTS.md`

**Step 1: Create README**

```markdown
# Personal AI

Local-first personal AI with plugin architecture. Memory + Tasks.

## Quick Start

\`\`\`bash
pnpm install
pnpm build
node packages/cli/dist/index.js task add "My first task"
node packages/cli/dist/index.js task list
\`\`\`

## Commands

\`\`\`
pai health                        Check LLM provider
pai memory remember <text>        Record observation, extract belief
pai memory recall <query>         Search beliefs
pai memory beliefs                List active beliefs
pai memory episodes               List recent episodes
pai task add <title>              Add task (--priority, --goal, --due)
pai task list                     List open tasks
pai task done <id>                Complete task
pai goal add <title>              Add goal
pai goal list                     List goals
pai task ai-suggest               AI task prioritization
\`\`\`

## Config

Set via environment variables or `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| PAI_DATA_DIR | ~/.personal-ai | Data directory |
| PAI_LLM_PROVIDER | ollama | ollama or openai |
| PAI_LLM_MODEL | llama3.2 | Model name |
| PAI_LLM_BASE_URL | http://127.0.0.1:11434 | Provider URL |
| PAI_LLM_API_KEY | | API key (openai) |
| PAI_PLUGINS | memory,tasks | Active plugins |
```

**Step 2: Create .env.example**

```
PAI_DATA_DIR=~/.personal-ai
PAI_LLM_PROVIDER=ollama
PAI_LLM_MODEL=llama3.2
PAI_LLM_BASE_URL=http://127.0.0.1:11434
PAI_PLUGINS=memory,tasks
```

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass across all packages

**Step 4: Commit**

```bash
git add README.md .env.example AGENTS.md
git commit -m "docs: add README, env example, and agent guide"
```

---

## Task Dependency Summary

```
Task 1 (scaffold) → Task 2 (types/config) → Task 3 (storage) → Task 4 (LLM)
                                                                       ↓
                                              Task 5 (memory CRUD) → Task 6 (memory LLM + export)
                                              Task 7 (tasks plugin)
                                                                       ↓
                                                              Task 8 (CLI) → Task 9 (polish)
```

Tasks 5-7 can run in parallel once Task 4 is done.

## Line Count Budget

| Package | Target |
|---------|--------|
| core | ~300 lines |
| cli | ~100 lines |
| plugin-memory | ~250 lines |
| plugin-tasks | ~250 lines |
| **Total** | **~900 lines** |

Well under the 2000 line budget from the design doc.
