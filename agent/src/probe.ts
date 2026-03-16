/**
 * Run all probes once — exercises the product and generates suggestions.
 *
 * Usage: pnpm probe
 * Env: PAI_URL (default http://127.0.0.1:3141)
 */
import * as health from "./probes/health.js";
import * as library from "./probes/library.js";
import * as digests from "./probes/digests.js";
import * as watches from "./probes/watches.js";
import { listSuggestions } from "./suggestions.js";

async function main() {
  console.log("=== pai product agent — running probes ===\n");

  const probes = [health, library, digests, watches];

  for (const probe of probes) {
    try {
      await probe.run();
    } catch (err) {
      console.error(`  Probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }

  const pending = listSuggestions("pending");
  console.log(`=== Done. ${pending.length} pending suggestions ===`);

  if (pending.length > 0) {
    console.log("\nRun `pnpm review` to review and approve suggestions.\n");
    for (const s of pending.slice(0, 10)) {
      console.log(`  [${s.priority}] ${s.title}`);
    }
    if (pending.length > 10) {
      console.log(`  ... and ${pending.length - 10} more`);
    }
  }
}

main().catch(console.error);
