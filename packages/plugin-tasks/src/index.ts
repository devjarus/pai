import type { Plugin, PluginContext, Command, LLMClient, Storage } from "@personal-ai/core";
import { taskMigrations, addTask, listTasks, completeTask, addGoal, listGoals } from "./tasks.js";

async function aiSuggest(storage: Storage, llm: LLMClient): Promise<string> {
  const tasks = listTasks(storage);
  const goals = listGoals(storage);

  if (tasks.length === 0) return "No open tasks. Add some with `pai task add`.";

  const taskList = tasks.map((t) => `- [${t.priority}] ${t.title}${t.due_date ? ` (due: ${t.due_date})` : ""}`).join("\n");
  const goalList = goals.map((g) => `- ${g.title}`).join("\n");

  const result = await llm.chat([
    {
      role: "system",
      content: "You are a productivity assistant. Given the user's tasks and goals, suggest what to work on next and why. Be concise (3-4 sentences max).",
    },
    {
      role: "user",
      content: `My goals:\n${goalList || "(none set)"}\n\nMy open tasks:\n${taskList}\n\nWhat should I focus on next?`,
    },
  ]);
  return result.text;
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
