import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStorage } from "@personal-ai/core";
import { taskMigrations, addTask, listTasks, completeTask, editTask, reopenTask, addGoal, listGoals, completeGoal } from "../src/tasks.js";
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

  it("should complete a task by unique id prefix", () => {
    const task = addTask(storage, { title: "Do thing" });
    completeTask(storage, task.id.slice(0, 8));
    const tasks = listTasks(storage);
    expect(tasks).toHaveLength(0); // completed tasks not in open list
  });

  it("should throw if task prefix is ambiguous", () => {
    storage.run("INSERT INTO tasks (id, title, priority, status) VALUES (?, ?, 'medium', 'open')", ["abc111", "A"]);
    storage.run("INSERT INTO tasks (id, title, priority, status) VALUES (?, ?, 'medium', 'open')", ["abc222", "B"]);
    expect(() => completeTask(storage, "abc")).toThrow(/ambiguous/i);
  });

  it("should throw if no task matches id or prefix", () => {
    addTask(storage, { title: "Existing task" });
    expect(() => completeTask(storage, "missing")).toThrow(/no open task matches/i);
  });

  it("should list completed tasks with done status filter", () => {
    const openTask = addTask(storage, { title: "Still open" });
    const doneTask = addTask(storage, { title: "Already done" });
    completeTask(storage, doneTask.id);
    const doneTasks = listTasks(storage, "done");
    expect(doneTasks).toHaveLength(1);
    expect(doneTasks[0]!.id).toBe(doneTask.id);
    expect(doneTasks[0]!.status).toBe("done");
    const openTasks = listTasks(storage, "open");
    expect(openTasks).toHaveLength(1);
    expect(openTasks[0]!.id).toBe(openTask.id);
  });

  it("should list all tasks with all status filter", () => {
    const first = addTask(storage, { title: "Task one" });
    const second = addTask(storage, { title: "Task two" });
    completeTask(storage, first.id);
    const allTasks = listTasks(storage, "all");
    expect(allTasks).toHaveLength(2);
    const ids = allTasks.map((t) => t.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
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

  it("should edit a task title", () => {
    const task = addTask(storage, { title: "Old title", priority: "low" });
    editTask(storage, task.id, { title: "New title" });
    const [updated] = storage.query<{ title: string }>("SELECT title FROM tasks WHERE id = ?", [task.id]);
    expect(updated!.title).toBe("New title");
  });

  it("should edit a task priority and due date", () => {
    const task = addTask(storage, { title: "Task", priority: "low" });
    editTask(storage, task.id, { priority: "high", dueDate: "2026-03-01" });
    const [updated] = storage.query<{ priority: string; due_date: string }>("SELECT priority, due_date FROM tasks WHERE id = ?", [task.id]);
    expect(updated!.priority).toBe("high");
    expect(updated!.due_date).toBe("2026-03-01");
  });

  it("should clear due date with empty string", () => {
    const task = addTask(storage, { title: "Task", dueDate: "2026-03-01" });
    editTask(storage, task.id, { dueDate: "" });
    const [updated] = storage.query<{ due_date: string | null }>("SELECT due_date FROM tasks WHERE id = ?", [task.id]);
    expect(updated!.due_date).toBeNull();
  });

  it("should throw when editing with no updates", () => {
    const task = addTask(storage, { title: "Task" });
    expect(() => editTask(storage, task.id, {})).toThrow(/no updates/i);
  });

  it("should reopen a completed task", () => {
    const task = addTask(storage, { title: "Done task" });
    completeTask(storage, task.id);
    expect(listTasks(storage)).toHaveLength(0);
    reopenTask(storage, task.id);
    expect(listTasks(storage)).toHaveLength(1);
    expect(listTasks(storage)[0]!.status).toBe("open");
  });

  it("should throw when reopening a non-done task", () => {
    const task = addTask(storage, { title: "Open task" });
    expect(() => reopenTask(storage, task.id)).toThrow(/no done task/i);
  });

  it("should complete a goal", () => {
    const goal = addGoal(storage, { title: "Ship v1" });
    completeGoal(storage, goal.id);
    const goals = listGoals(storage);
    expect(goals).toHaveLength(0); // completed goals not in active list
  });

  it("should complete a goal by prefix", () => {
    const goal = addGoal(storage, { title: "Ship v1" });
    completeGoal(storage, goal.id.slice(0, 8));
    expect(listGoals(storage)).toHaveLength(0);
  });

  it("should throw when completing non-active goal", () => {
    const goal = addGoal(storage, { title: "Ship v1" });
    completeGoal(storage, goal.id);
    expect(() => completeGoal(storage, goal.id)).toThrow(/no active goal/i);
  });

  it("should reject empty task title", () => {
    expect(() => addTask(storage, { title: "" })).toThrow(/title cannot be empty/i);
    expect(() => addTask(storage, { title: "  " })).toThrow(/title cannot be empty/i);
  });

  it("should reject invalid priority on add", () => {
    expect(() => addTask(storage, { title: "Test", priority: "banana" })).toThrow(/invalid priority/i);
  });

  it("should reject invalid priority on edit", () => {
    const task = addTask(storage, { title: "Test" });
    expect(() => editTask(storage, task.id, { priority: "banana" })).toThrow(/invalid priority/i);
  });

  it("should reject empty title on edit", () => {
    const task = addTask(storage, { title: "Test" });
    expect(() => editTask(storage, task.id, { title: "" })).toThrow(/title cannot be empty/i);
  });
});
