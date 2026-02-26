import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_FILE = path.join(os.tmpdir(), "pai-e2e-state.json");

export default async function globalTeardown() {
  // Read state written by global-setup
  let state: { paiPid?: number; tmpDir?: string } = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    // If state file is missing, nothing to clean up
    return;
  }

  // Kill the PAI server process
  if (state.paiPid) {
    try {
      process.kill(state.paiPid, "SIGTERM");
    } catch {
      // Process may have already exited
    }

    // Give it a moment to shut down gracefully
    await new Promise((r) => setTimeout(r, 500));

    // Force kill if still running
    try {
      process.kill(state.paiPid, 0); // check if alive
      process.kill(state.paiPid, "SIGKILL");
    } catch {
      // Already dead — good
    }
  }

  // Close mock LLM server (if still referenced on globalThis)
  const mockServer = (globalThis as Record<string, unknown>).__mockLLM;
  if (mockServer && typeof (mockServer as { close: () => void }).close === "function") {
    (mockServer as { close: () => void }).close();
  }

  // Remove temp data directory
  if (state.tmpDir && fs.existsSync(state.tmpDir)) {
    fs.rmSync(state.tmpDir, { recursive: true, force: true });
  }

  // Clean up state file
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // ignore
  }
}
