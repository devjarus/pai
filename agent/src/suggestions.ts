/**
 * Suggestion store — probes write suggestions, user reviews them.
 * Stored as a simple JSON file.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, "..", "suggestions.json");

export type Priority = "critical" | "high" | "medium" | "low";
export type Status = "pending" | "approved" | "rejected" | "done";
export type Category = "bug" | "quality" | "ux" | "performance" | "feature" | "research";

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: Status;
  probe: string;          // which probe found this
  evidence: string;       // concrete data backing the suggestion
  proposedFix?: string;   // what a coding agent should do
  createdAt: string;
  reviewedAt?: string;
  reviewNote?: string;
}

function loadStore(): Suggestion[] {
  if (!existsSync(STORE_PATH)) return [];
  return JSON.parse(readFileSync(STORE_PATH, "utf8")) as Suggestion[];
}

function saveStore(suggestions: Suggestion[]): void {
  writeFileSync(STORE_PATH, JSON.stringify(suggestions, null, 2) + "\n", "utf8");
}

export function addSuggestion(input: Omit<Suggestion, "id" | "status" | "createdAt">): Suggestion {
  const suggestions = loadStore();

  // Dedupe — don't add if same title exists and is pending
  const existing = suggestions.find(s => s.title === input.title && s.status === "pending");
  if (existing) return existing;

  const suggestion: Suggestion = {
    ...input,
    id: randomUUID().slice(0, 8),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  suggestions.push(suggestion);
  saveStore(suggestions);
  return suggestion;
}

export function listSuggestions(status?: Status): Suggestion[] {
  return loadStore().filter(s => !status || s.status === status);
}

export function updateSuggestion(id: string, update: Partial<Pick<Suggestion, "status" | "reviewNote">>): Suggestion | undefined {
  const suggestions = loadStore();
  const idx = suggestions.findIndex(s => s.id === id);
  if (idx === -1) return undefined;
  const s = suggestions[idx]!;
  if (update.status) s.status = update.status;
  if (update.reviewNote) s.reviewNote = update.reviewNote;
  s.reviewedAt = new Date().toISOString();
  saveStore(suggestions);
  return s;
}

export function getApprovedSuggestions(): Suggestion[] {
  return loadStore().filter(s => s.status === "approved");
}

export function markDone(id: string): void {
  updateSuggestion(id, { status: "done" });
}
