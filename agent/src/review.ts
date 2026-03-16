/**
 * Interactive review of pending suggestions.
 *
 * Usage: pnpm review
 */
import { createInterface } from "node:readline";
import { listSuggestions, updateSuggestion, getApprovedSuggestions } from "./suggestions.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const pending = listSuggestions("pending");

  if (pending.length === 0) {
    console.log("No pending suggestions. Run `pnpm probe` first.\n");
    rl.close();
    return;
  }

  console.log(`\n=== ${pending.length} pending suggestions ===\n`);

  for (const s of pending) {
    console.log(`[${"■".repeat({ critical: 4, high: 3, medium: 2, low: 1 }[s.priority])}] ${s.priority.toUpperCase()}`);
    console.log(`  ${s.title}`);
    console.log(`  ${s.description}`);
    console.log(`  Category: ${s.category} | Probe: ${s.probe}`);
    console.log(`  Evidence: ${s.evidence.slice(0, 200)}`);
    if (s.proposedFix) console.log(`  Fix: ${s.proposedFix}`);
    console.log();

    const answer = await ask("  [a]pprove / [r]eject / [s]kip / [q]uit? ");
    const choice = answer.trim().toLowerCase();

    if (choice === "a") {
      const note = await ask("  Note (optional): ");
      updateSuggestion(s.id, { status: "approved", reviewNote: note || undefined });
      console.log("  → Approved\n");
    } else if (choice === "r") {
      const note = await ask("  Reason (optional): ");
      updateSuggestion(s.id, { status: "rejected", reviewNote: note || undefined });
      console.log("  → Rejected\n");
    } else if (choice === "q") {
      break;
    } else {
      console.log("  → Skipped\n");
    }
  }

  const approved = getApprovedSuggestions();
  if (approved.length > 0) {
    console.log(`\n=== ${approved.length} approved suggestions ready for implementation ===\n`);
    for (const s of approved) {
      console.log(`  [${s.id}] ${s.title}`);
      if (s.proposedFix) console.log(`    Fix: ${s.proposedFix}`);
    }
    console.log("\nA coding agent can read suggestions.json and implement approved items.\n");
  }

  rl.close();
}

main().catch(console.error);
