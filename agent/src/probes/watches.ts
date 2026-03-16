/**
 * Watch probe — checks watch health, scheduling, research execution.
 */
import * as api from "../pai-client.js";
import { addSuggestion } from "../suggestions.js";

export async function run(): Promise<void> {
  console.log("[probe:watches] Checking Watch health...");

  try {
    const { data: watches } = await api.listWatches();
    const active = Array.isArray(watches) ? watches.filter(w => w.status === "active") : [];
    console.log(`  Watches: ${Array.isArray(watches) ? watches.length : 0} total, ${active.length} active`);

    if (active.length === 0) {
      addSuggestion({
        title: "No active watches",
        description: "No watches are actively monitoring. The product's core value isn't being exercised.",
        category: "ux",
        priority: "medium",
        probe: "watches",
        evidence: "0 active watches",
        proposedFix: "Prompt user to create a watch if none exist after first chat session",
      });
    }

    // Check for stale watches (haven't run in 2x their interval)
    for (const watch of active) {
      if (watch.lastRunAt && watch.nextRunAt) {
        const nextRun = new Date(watch.nextRunAt).getTime();
        const now = Date.now();
        const overdue = now - nextRun;
        if (overdue > 24 * 60 * 60 * 1000) { // overdue by > 24h
          addSuggestion({
            title: `Watch "${watch.title}" is overdue by ${Math.round(overdue / 3600000)}h`,
            description: `Watch was due at ${watch.nextRunAt} but hasn't run. May indicate worker issues.`,
            category: "bug",
            priority: "high",
            probe: "watches",
            evidence: `Watch ID: ${watch.id}, due: ${watch.nextRunAt}, last run: ${watch.lastRunAt}`,
            proposedFix: "Check schedule worker is running, verify watch isn't stuck",
          });
        }
      }
    }

    // Check templates availability
    const { data: templates } = await api.watchTemplates();
    console.log(`  Templates: ${Array.isArray(templates) ? templates.length : 0}`);
  } catch (err) {
    console.log(`  Watch check failed: ${err}`);
  }
}
