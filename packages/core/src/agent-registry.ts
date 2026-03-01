/**
 * Dynamic agent registry — user-created agents stored in SQLite.
 * These complement the hardcoded AgentPlugin agents (assistant, curator).
 */

import { nanoid } from "nanoid";
import type { Storage, Migration } from "./types.js";

export interface DynamicAgent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  /** JSON array of DynamicToolDef */
  tools: DynamicToolDef[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DynamicToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool input (Zod-compatible) */
  inputSchema: Record<string, unknown>;
  /** Code to execute in sandbox when the tool is called.
   *  Receives `args` as a JSON object and `OUTPUT_DIR` env var.
   *  Must print the result to stdout as JSON. */
  code: string;
  language: "python" | "node";
}

export interface CreateDynamicAgentOpts {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  capabilities?: string[];
  tools?: DynamicToolDef[];
}

interface DynamicAgentRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  system_prompt: string;
  capabilities: string;
  tools: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export const agentRegistryMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS dynamic_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '[]',
        tools TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_dynamic_agents_name ON dynamic_agents(name);
    `,
  },
];

function rowToAgent(row: DynamicAgentRow): DynamicAgent {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    systemPrompt: row.system_prompt,
    capabilities: JSON.parse(row.capabilities) as string[],
    tools: JSON.parse(row.tools) as DynamicToolDef[],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDynamicAgent(storage: Storage, opts: CreateDynamicAgentOpts): DynamicAgent {
  const id = nanoid();
  const safeName = opts.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 50);
  const capabilities = JSON.stringify(opts.capabilities ?? []);
  const tools = JSON.stringify(opts.tools ?? []);

  storage.run(
    `INSERT INTO dynamic_agents (id, name, display_name, description, system_prompt, capabilities, tools, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [id, safeName, opts.displayName, opts.description, opts.systemPrompt, capabilities, tools],
  );

  return getDynamicAgent(storage, id)!;
}

export function getDynamicAgent(storage: Storage, id: string): DynamicAgent | null {
  const rows = storage.query<DynamicAgentRow>(
    "SELECT * FROM dynamic_agents WHERE id = ?",
    [id],
  );
  if (rows.length === 0) return null;
  return rowToAgent(rows[0]!);
}

export function getDynamicAgentByName(storage: Storage, name: string): DynamicAgent | null {
  const rows = storage.query<DynamicAgentRow>(
    "SELECT * FROM dynamic_agents WHERE name = ?",
    [name],
  );
  if (rows.length === 0) return null;
  return rowToAgent(rows[0]!);
}

export function listDynamicAgents(storage: Storage, onlyEnabled = true): DynamicAgent[] {
  const sql = onlyEnabled
    ? "SELECT * FROM dynamic_agents WHERE enabled = 1 ORDER BY created_at DESC"
    : "SELECT * FROM dynamic_agents ORDER BY created_at DESC";
  return storage.query<DynamicAgentRow>(sql).map(rowToAgent);
}

export function updateDynamicAgent(
  storage: Storage,
  id: string,
  updates: Partial<Pick<DynamicAgent, "displayName" | "description" | "systemPrompt" | "capabilities" | "tools" | "enabled">>,
): DynamicAgent | null {
  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (updates.displayName !== undefined) { fields.push("display_name = ?"); values.push(updates.displayName); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.systemPrompt !== undefined) { fields.push("system_prompt = ?"); values.push(updates.systemPrompt); }
  if (updates.capabilities !== undefined) { fields.push("capabilities = ?"); values.push(JSON.stringify(updates.capabilities)); }
  if (updates.tools !== undefined) { fields.push("tools = ?"); values.push(JSON.stringify(updates.tools)); }
  if (updates.enabled !== undefined) { fields.push("enabled = ?"); values.push(updates.enabled ? 1 : 0); }

  values.push(id);
  storage.run(`UPDATE dynamic_agents SET ${fields.join(", ")} WHERE id = ?`, values);
  return getDynamicAgent(storage, id);
}

export function deleteDynamicAgent(storage: Storage, id: string): boolean {
  const result = storage.run("DELETE FROM dynamic_agents WHERE id = ?", [id]);
  return result.changes > 0;
}
