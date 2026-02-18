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

export type TaskStatusFilter = "open" | "done" | "all";

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

export function listTasks(storage: Storage, status: TaskStatusFilter = "open"): Task[] {
  const tasks =
    status === "all"
      ? storage.query<Task>("SELECT * FROM tasks ORDER BY created_at DESC")
      : storage.query<Task>("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC", [status]);
  return tasks.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));
}

function resolveTaskId(storage: Storage, taskId: string, status = "open"): Pick<Task, "id"> {
  const exact = storage.query<Pick<Task, "id">>(
    `SELECT id FROM tasks WHERE id = ? AND status = ? LIMIT 1`,
    [taskId, status],
  );
  if (exact[0]) return exact[0];
  const prefixMatches = storage.query<Pick<Task, "id">>(
    `SELECT id FROM tasks WHERE id LIKE ? AND status = ? ORDER BY created_at DESC LIMIT 2`,
    [`${taskId}%`, status],
  );
  if (prefixMatches.length === 0) throw new Error(`No ${status} task matches "${taskId}".`);
  if (prefixMatches.length > 1) throw new Error(`Task id prefix "${taskId}" is ambiguous. Provide more characters.`);
  return prefixMatches[0]!;
}

export function completeTask(storage: Storage, taskId: string): void {
  const task = resolveTaskId(storage, taskId);
  storage.run("UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?", [task.id]);
}

export function editTask(
  storage: Storage,
  taskId: string,
  updates: { title?: string; priority?: string; dueDate?: string },
): void {
  const task = resolveTaskId(storage, taskId);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
  if (updates.priority !== undefined) { sets.push("priority = ?"); params.push(updates.priority); }
  if (updates.dueDate !== undefined) { sets.push("due_date = ?"); params.push(updates.dueDate || null); }
  if (sets.length === 0) throw new Error("No updates provided.");
  params.push(task.id);
  storage.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);
}

export function reopenTask(storage: Storage, taskId: string): void {
  const task = resolveTaskId(storage, taskId, "done");
  storage.run("UPDATE tasks SET status = 'open', completed_at = NULL WHERE id = ?", [task.id]);
}

export function completeGoal(storage: Storage, goalId: string): void {
  const rows = storage.query<Pick<Goal, "id">>(
    "SELECT id FROM goals WHERE id = ? AND status = 'active' LIMIT 1",
    [goalId],
  );
  const id = rows[0]?.id ?? (() => {
    const prefixMatches = storage.query<Pick<Goal, "id">>(
      "SELECT id FROM goals WHERE id LIKE ? AND status = 'active' ORDER BY created_at DESC LIMIT 2",
      [`${goalId}%`],
    );
    if (prefixMatches.length === 0) throw new Error(`No active goal matches "${goalId}".`);
    if (prefixMatches.length > 1) throw new Error(`Goal id prefix "${goalId}" is ambiguous. Provide more characters.`);
    return prefixMatches[0]!.id;
  })();
  storage.run("UPDATE goals SET status = 'done' WHERE id = ?", [id]);
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
