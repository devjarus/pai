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
