import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startMockLLM } from "./mock-llm";

const MOCK_LLM_PORT = 11435;
const PAI_PORT = 3199;
const HEALTH_URL = `http://127.0.0.1:${PAI_PORT}/api/health`;
const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 300;

/** Path where we stash PIDs + temp dir path for teardown */
const STATE_FILE = path.join(os.tmpdir(), "pai-e2e-state.json");

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  // 1. Create temp data directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pai-e2e-"));

  // 2. Start mock LLM server
  let mockServer: Server;
  try {
    mockServer = await startMockLLM(MOCK_LLM_PORT);
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to start mock LLM server: ${err}`);
  }

  // 3. Start real PAI server
  const serverEntry = path.resolve(
    process.cwd(),
    "packages/server/dist/index.js",
  );

  if (!fs.existsSync(serverEntry)) {
    mockServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(
      `Server not built. Run 'pnpm build' first. Expected: ${serverEntry}`,
    );
  }

  const paiServer: ChildProcess = spawn("node", [serverEntry], {
    env: {
      ...process.env,
      PAI_DATA_DIR: tmpDir,
      PAI_LLM_PROVIDER: "ollama",
      PAI_LLM_MODEL: "mock-model",
      PAI_LLM_BASE_URL: `http://127.0.0.1:${MOCK_LLM_PORT}`,
      PAI_LLM_EMBED_PROVIDER: "ollama",
      PAI_HOST: "0.0.0.0",
      PORT: String(PAI_PORT),
      PAI_LOG_LEVEL: "silent",
      // Prevent Telegram bot from starting during E2E tests
      PAI_TELEGRAM_TOKEN: "",
    },
    stdio: "pipe",
  });

  // Capture output for debugging startup failures
  let serverOutput = "";
  paiServer.stdout?.on("data", (d: Buffer) => {
    serverOutput += d.toString();
  });
  paiServer.stderr?.on("data", (d: Buffer) => {
    serverOutput += d.toString();
  });

  // Handle early exit
  const earlyExit = new Promise<never>((_, reject) => {
    paiServer.on("exit", (code) => {
      reject(
        new Error(
          `PAI server exited early with code ${code}.\nOutput:\n${serverOutput}`,
        ),
      );
    });
  });

  // 4. Wait for server to be ready
  try {
    await Promise.race([waitForServer(HEALTH_URL, MAX_WAIT_MS), earlyExit]);
  } catch (err) {
    paiServer.kill("SIGTERM");
    mockServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  // 5. Save state for teardown
  const mockAddress = mockServer.address();
  const state = {
    paiPid: paiServer.pid,
    tmpDir,
    mockLLMPort: typeof mockAddress === "object" ? mockAddress?.port : MOCK_LLM_PORT,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));

  // Keep references alive so Node doesn't GC them
  // Store on globalThis so the process keeps running
  (globalThis as Record<string, unknown>).__paiServer = paiServer;
  (globalThis as Record<string, unknown>).__mockLLM = mockServer;
}
