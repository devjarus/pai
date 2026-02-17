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
});
