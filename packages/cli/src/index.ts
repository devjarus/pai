#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, createStorage, createLLMClient, createLogger, memoryMigrations, knowledgeMigrations, memoryCommands, getMemoryContext, learnFromContent, knowledgeSearch, listSources, forgetSource, hasSource } from "@personal-ai/core";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";
import type { Plugin, PluginContext, Command as PaiCommand } from "@personal-ai/core";
import { tasksPlugin } from "@personal-ai/plugin-tasks";
import { createInitCommand } from "./init.js";
import { spawn, fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";

const program = new Command();
program
  .name("pai")
  .description("Persistent AI memory — belief lifecycle, semantic search, and tasks for coding agents")
  .version("0.1.0")
  .option("--json", "Output as JSON for agent consumption");

// Register init command early (doesn't need plugins or storage)
program.addCommand(createInitCommand());

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
      if (program.opts()["json"]) {
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

  // Memory + Knowledge are always available — run migrations unconditionally
  storage.migrate("memory", memoryMigrations);
  storage.migrate("knowledge", knowledgeMigrations);
  ctx.contextProvider = (query: string) => getMemoryContext(storage, query, { llm });

  for (const cmd of memoryCommands(ctx)) {
    registerCommand(program, ctx, cmd);
  }

  // --- Knowledge commands ---
  const knowledge = program.command("knowledge").description("Manage the knowledge base (learned web pages)");

  knowledge
    .command("learn")
    .description("Learn from a web page — fetch, extract, chunk, and store in knowledge base")
    .argument("<url>", "URL to learn from")
    .action(async (url: string) => {
      try {
        const existing = hasSource(storage, url);
        if (existing) {
          if (program.opts()["json"]) { console.log(JSON.stringify({ skipped: true, title: existing.title })); }
          else { console.log(`Already learned from "${existing.title}".`); }
          return;
        }
        const page = await fetchPageAsMarkdown(url);
        if (!page) {
          if (program.opts()["json"]) { console.log(JSON.stringify({ error: "Could not extract content from URL" })); }
          else { console.error("Could not extract content from that URL."); }
          process.exitCode = 1;
          return;
        }
        const result = await learnFromContent(storage, llm, url, page.title, page.markdown);
        if (program.opts()["json"]) {
          console.log(JSON.stringify({ title: result.source.title, chunks: result.chunksStored, url: result.source.url }));
        } else {
          console.log(`Learned from "${result.source.title}" — ${result.chunksStored} chunks stored.`);
        }
      } catch (err) {
        if (program.opts()["json"]) { console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) })); }
        else { console.error("Error:", err instanceof Error ? err.message : err); }
        process.exitCode = 1;
      }
    });

  knowledge
    .command("search")
    .description("Search the knowledge base")
    .argument("<query>", "Search query")
    .action(async (query: string) => {
      try {
        const results = await knowledgeSearch(storage, llm, query);
        if (results.length === 0) {
          if (program.opts()["json"]) { console.log("[]"); }
          else { console.log("No matching knowledge found."); }
          process.exitCode = 2;
          return;
        }
        if (program.opts()["json"]) {
          console.log(JSON.stringify(results.map((r) => ({
            content: r.chunk.content.slice(0, 500),
            source: r.source.title,
            url: r.source.url,
            relevance: Math.round(r.score * 100),
          }))));
        } else {
          for (const r of results) {
            console.log(`\n--- ${r.source.title} (${Math.round(r.score * 100)}%) ---`);
            console.log(`URL: ${r.source.url}`);
            console.log(r.chunk.content.slice(0, 300));
          }
        }
      } catch (err) {
        if (program.opts()["json"]) { console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) })); }
        else { console.error("Error:", err instanceof Error ? err.message : err); }
        process.exitCode = 1;
      }
    });

  knowledge
    .command("list")
    .description("List all learned sources in the knowledge base")
    .action(() => {
      const sources = listSources(storage);
      if (sources.length === 0) {
        if (program.opts()["json"]) { console.log("[]"); }
        else { console.log("Knowledge base is empty."); }
        process.exitCode = 2;
        return;
      }
      if (program.opts()["json"]) {
        console.log(JSON.stringify(sources.map((s) => ({
          id: s.id.slice(0, 8),
          title: s.title,
          url: s.url,
          chunks: s.chunk_count,
          learnedAt: s.fetched_at,
        }))));
      } else {
        for (const s of sources) {
          console.log(`${s.id.slice(0, 8)}  ${s.title} (${s.chunk_count} chunks)`);
          console.log(`         ${s.url}`);
        }
      }
    });

  knowledge
    .command("forget")
    .description("Remove a learned source and its chunks from the knowledge base")
    .argument("<id>", "Source ID or prefix")
    .action((sourceId: string) => {
      try {
        const sources = listSources(storage);
        const match = sources.find((s) => s.id.startsWith(sourceId));
        if (!match) {
          if (program.opts()["json"]) { console.log(JSON.stringify({ error: "Source not found" })); }
          else { console.error(`No source found with ID starting with "${sourceId}".`); }
          process.exitCode = 1;
          return;
        }
        forgetSource(storage, match.id);
        if (program.opts()["json"]) {
          console.log(JSON.stringify({ ok: true, title: match.title, chunks: match.chunk_count }));
        } else {
          console.log(`Removed "${match.title}" and ${match.chunk_count} chunks.`);
        }
      } catch (err) {
        if (program.opts()["json"]) { console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) })); }
        else { console.error("Error:", err instanceof Error ? err.message : err); }
        process.exitCode = 1;
      }
    });

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

  // --- Server management ---
  const PID_DIR = join(homedir(), ".personal-ai");
  const PID_FILE = join(PID_DIR, "server.pid");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const serverEntry = join(__dirname, "../../server/dist/index.js");

  function readPidFile(): { pid: number; port: number; host: string } | null {
    try {
      if (!existsSync(PID_FILE)) return null;
      const lines = readFileSync(PID_FILE, "utf-8").trim().split("\n");
      const pid = parseInt(lines[0]!, 10);
      // Check if process is actually running
      try { process.kill(pid, 0); } catch { return null; }
      return { pid, port: parseInt(lines[1] ?? "3141", 10), host: lines[2] ?? "127.0.0.1" };
    } catch { return null; }
  }

  function openBrowser(url: string) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  }

  // --- Backup command ---
  program
    .command("backup")
    .description("Create a timestamped backup of the database")
    .action(() => {
      const dbPath = join(config.dataDir, "personal-ai.db");
      if (!existsSync(dbPath)) {
        console.error("No database found to backup.");
        process.exitCode = 1;
        return;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupPath = join(config.dataDir, `personal-ai-backup-${timestamp}.db`);
      // Checkpoint WAL before backup
      try { storage.run("PRAGMA wal_checkpoint(TRUNCATE)", []); } catch { /* ignore */ }
      copyFileSync(dbPath, backupPath);
      if (program.opts()["json"]) {
        console.log(JSON.stringify({ ok: true, path: backupPath }));
      } else {
        console.log(`Backup created: ${backupPath}`);
      }
    });

  const server = program
    .command("server")
    .description("Manage the pai server");

  server
    .command("start")
    .description("Start the server (foreground by default)")
    .option("-p, --port <port>", "Port to listen on", "3141")
    .option("-H, --host <host>", "Host to bind to", "127.0.0.1")
    .option("-d, --daemon", "Run in background")
    .action(async (opts: { port: string; host: string; daemon: boolean }) => {
      const running = readPidFile();
      if (running) {
        console.log(`pai server already running (PID ${running.pid}) at http://${running.host}:${running.port}`);
        return;
      }

      const port = opts.port;
      const host = opts.host;

      if (opts.daemon) {
        // Daemon mode — fork and detach
        mkdirSync(PID_DIR, { recursive: true });
        const child = fork(serverEntry, ["--port", port, "--host", host], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        // Give server a moment to write PID file and bind
        await new Promise((r) => setTimeout(r, 1500));
        const info = readPidFile();
        if (info) {
          console.log(`pai server started (PID ${info.pid}) at http://${host}:${port}`);
        } else {
          console.log(`pai server started in background on port ${port}`);
        }
      } else {
        // Foreground mode
        const child = spawn("node", [serverEntry, "--port", port, "--host", host], {
          stdio: "inherit",
        });
        process.on("SIGINT", () => child.kill("SIGINT"));
        process.on("SIGTERM", () => child.kill("SIGTERM"));
        await new Promise<void>((resolve) => {
          child.on("exit", () => { storage.close(); resolve(); });
        });
      }
    });

  server
    .command("stop")
    .description("Stop the background server")
    .action(() => {
      const info = readPidFile();
      if (!info) {
        console.log("No pai server is running.");
        return;
      }
      try {
        process.kill(info.pid, "SIGTERM");
        console.log(`Stopped pai server (PID ${info.pid})`);
      } catch {
        console.log("Server process not found. Cleaning up PID file.");
      }
    });

  server
    .command("status")
    .description("Check if the server is running")
    .action(() => {
      const info = readPidFile();
      if (info) {
        console.log(`pai server is running (PID ${info.pid}) at http://${info.host}:${info.port}`);
      } else {
        console.log("pai server is not running.");
      }
      if (program.opts()["json"]) {
        console.log(JSON.stringify(info ? { running: true, ...info } : { running: false }));
      }
    });

  // Make `pai server` without subcommand default to `pai server start`
  server.action(async () => {
    await server.commands.find(c => c.name() === "start")!.parseAsync(process.argv.slice(3));
  });

  // UI shorthand — start server + open browser
  program
    .command("ui")
    .description("Start server and open the web UI in your browser")
    .option("-p, --port <port>", "Port to listen on", "3141")
    .option("-H, --host <host>", "Host to bind to", "127.0.0.1")
    .option("--no-open", "Don't open browser automatically")
    .action(async (opts: { port: string; host: string; open: boolean }) => {
      const running = readPidFile();
      const port = running ? running.port : parseInt(opts.port, 10);
      const host = running ? running.host : opts.host;
      const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

      if (running) {
        console.log(`pai server already running (PID ${running.pid})`);
        if (opts.open) { openBrowser(url); console.log(`Opened ${url}`); }
        return;
      }

      // Start in foreground
      const child = spawn("node", [serverEntry, "--port", String(port), "--host", host], {
        stdio: "inherit",
      });

      if (opts.open) {
        setTimeout(() => { openBrowser(url); console.log(`Opened ${url}`); }, 1500);
      }

      process.on("SIGINT", () => child.kill("SIGINT"));
      process.on("SIGTERM", () => child.kill("SIGTERM"));
      await new Promise<void>((resolve) => {
        child.on("exit", () => { storage.close(); resolve(); });
      });
    });

  // --- Worker management ---
  const workerEntry = join(__dirname, "../../server/dist/worker.js");

  program
    .command("worker")
    .description("Run background workers (briefing, schedules, learning)")
    .option("-d, --daemon", "Run in background")
    .action(async (opts: { daemon?: boolean }) => {
      if (opts.daemon) {
        mkdirSync(PID_DIR, { recursive: true });
        const child = fork(workerEntry, [], { detached: true, stdio: "ignore" });
        child.unref();
        console.log(`pai worker started in background (PID ${child.pid})`);
      } else {
        const child = spawn("node", [workerEntry], { stdio: "inherit" });
        process.on("SIGINT", () => child.kill("SIGINT"));
        process.on("SIGTERM", () => child.kill("SIGTERM"));
        await new Promise<void>((resolve) => {
          child.on("exit", () => { storage.close(); resolve(); });
        });
      }
    });

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
