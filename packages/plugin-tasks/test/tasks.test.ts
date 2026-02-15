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
