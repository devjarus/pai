/**
 * Continuous mode — runs probes on an interval.
 *
 * Usage: pnpm run run
 * Env: PAI_URL, PROBE_INTERVAL_MINUTES (default 30)
 */
import * as health from "./probes/health.js";
import * as library from "./probes/library.js";
import * as digests from "./probes/digests.js";
import * as watches from "./probes/watches.js";
import { listSuggestions } from "./suggestions.js";

const INTERVAL_MS = (parseInt(process.env.PROBE_INTERVAL_MINUTES || "30", 10)) * 60 * 1000;

async function runProbes() {
  const timestamp = new Date().toISOString().slice(0, 19);
  console.log(`\n[${timestamp}] Running probes...`);

  const probes = [health, library, digests, watches];
  for (const probe of probes) {
    try {
      await probe.run();
    } catch (err) {
      console.error(`  Probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const pending = listSuggestions("pending");
  console.log(`[${timestamp}] ${pending.length} pending suggestions. Run \`pnpm review\` to review.`);
}

console.log(`pai product agent — continuous mode (every ${INTERVAL_MS / 60000}min)`);
console.log(`Target: ${process.env.PAI_URL || "http://127.0.0.1:3141"}`);

// Run immediately, then on interval
await runProbes();
setInterval(runProbes, INTERVAL_MS);
