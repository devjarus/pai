#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, createStorage, createLLMClient, createLogger, memoryMigrations, memoryCommands, getMemoryContext } from "@personal-ai/core";
import type { Plugin, PluginContext, Command as PaiCommand } from "@personal-ai/core";
import { tasksPlugin } from "@personal-ai/plugin-tasks";

const program = new Command();
program
  .name("pai")
  .description("Persistent AI memory — belief lifecycle, semantic search, and tasks for coding agents")
  .version("0.1.0")
  .option("--json", "Output as JSON for agent consumption");

const plugins: Record<string, Plugin> = {
  tasks: tasksPlugin,
};

function registerCommand(parent: Command, ctx: PluginContext, cmd: PaiCommand): void {
  const parts = cmd.name.split(" ");
  let target = parent;

  // Handle subcommands like "memory remember" or "task add"
  if (parts.length === 2) {
    const groupName = parts[0]!;
    let group = parent.commands.find((c) => c.name() === groupName);
    if (!group) {
      group = parent.command(groupName).description(`${groupName} commands`);
    }
    target = group;
  }

  const sub = target.command(parts[parts.length - 1]!).description(cmd.description);

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
      // Set json mode from global flag before each action
      ctx.json = program.opts()["json"] ?? false;

      // Commander passes positional args first, then opts object, then the Command
      const cmdObj = actionArgs[actionArgs.length - 1] as { opts: () => Record<string, string> };
      const opts = cmdObj.opts();
      const argValues: Record<string, string> = {};
      const argDefs = cmd.args ?? [];
      for (let i = 0; i < argDefs.length; i++) {
        argValues[argDefs[i]!.name] = actionArgs[i] as string;
      }
      ctx.exitCode = undefined;
      await cmd.action(argValues, opts);
      if (ctx.exitCode) process.exitCode = ctx.exitCode;
    } catch (err) {
      if (ctx.json) {
        console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      } else {
        console.error("Error:", err instanceof Error ? err.message : err);
      }
      process.exitCode = 1;
    }
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { dir: config.dataDir });
  const storage = createStorage(config.dataDir, logger);
  const llm = createLLMClient(config.llm, logger);

  logger.info("Starting pai", { plugins: config.plugins, dataDir: config.dataDir });

  const ctx: PluginContext = { config, storage, llm, logger };

  // Memory is always available — run migrations and register commands unconditionally
  storage.migrate("memory", memoryMigrations);
  ctx.contextProvider = (query: string) => getMemoryContext(storage, query, { llm });

  for (const cmd of memoryCommands(ctx)) {
    registerCommand(program, ctx, cmd);
  }

  // Load and migrate active plugins (filter out "memory" for backwards compat)
  const activePlugins = config.plugins.filter((p) => p !== "memory");
  for (const name of activePlugins) {
    const plugin = plugins[name];
    if (!plugin) {
      logger.warn(`Unknown plugin: ${name}`);
      continue;
    }
    storage.migrate(plugin.name, plugin.migrations);

    for (const cmd of plugin.commands(ctx)) {
      registerCommand(program, ctx, cmd);
    }
  }

  // Health check command (built-in)
  program
    .command("health")
    .description("Check LLM provider health")
    .action(async () => {
      const result = await llm.health();
      if (program.opts()["json"]) {
        console.log(JSON.stringify(result));
      } else {
        console.log(`Provider: ${result.provider}`);
        console.log(`Status: ${result.ok ? "OK" : "UNAVAILABLE"}`);
      }
      if (!result.ok) process.exitCode = 1;
    });

  await program.parseAsync(process.argv);
  storage.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
