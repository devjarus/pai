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

export function completeTask(storage: Storage, taskId: string): void {
  const exactMatch = storage.query<Pick<Task, "id">>(
    "SELECT id FROM tasks WHERE id = ? AND status = 'open' LIMIT 1",
    [taskId],
  );
  const resolvedTaskId =
    exactMatch[0]?.id ??
    (() => {
      const prefixMatches = storage.query<Pick<Task, "id">>(
        "SELECT id FROM tasks WHERE id LIKE ? AND status = 'open' ORDER BY created_at DESC LIMIT 2",
        [`${taskId}%`],
      );
      if (prefixMatches.length === 0) {
        throw new Error(`No open task matches "${taskId}".`);
      }
      if (prefixMatches.length > 1) {
        throw new Error(`Task id prefix "${taskId}" is ambiguous. Provide more characters.`);
      }
      return prefixMatches[0]!.id;
    })();

  storage.run("UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE id = ?", [resolvedTaskId]);
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
