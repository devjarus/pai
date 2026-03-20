import type { LLMClient, Logger, Storage } from "../types.js";
import { listBeliefs } from "./memory.js";
import type { Belief } from "./memory.js";
import { rememberStructured } from "./remember.js";

/**
 * Theme categories for profile consolidation.
 * Each theme groups related beliefs into a single dense statement.
 */
const THEME_PATTERNS: Array<{ theme: string; test: RegExp }> = [
  { theme: "communication_style", test: /\b(prefer|concise|brief|actionable|to.the.point|format|report|summary|delta|verbose|detailed)\b/i },
  { theme: "crypto_investment", test: /\b(crypto|bitcoin|btc|ethereum|eth|invest|trading|portfolio|aggressive|allocation)\b/i },
  { theme: "news_interests", test: /\b(news|headline|politics|technology|finance|world.events|breaking|current.events)\b/i },
  { theme: "immigration", test: /\b(visa|immigration|relocat|passport|consulate|appointment|h[1-4]b?)\b/i },
  { theme: "research_style", test: /\b(research|analysis|deep.dive|swarm|delta.update|fresh.info|sources|data.driven)\b/i },
];

function classifyTheme(statement: string): string | null {
  for (const { theme, test } of THEME_PATTERNS) {
    if (test.test(statement)) return theme;
  }
  return null;
}

export interface ConsolidationResult {
  themesProcessed: number;
  beliefsConsolidated: number;
  beliefsCreated: number;
}

/**
 * Consolidate scattered beliefs into dense profile statements.
 *
 * For each theme with 3+ beliefs, asks the LLM to merge them into
 * one comprehensive statement. Creates the merged belief at high
 * confidence and invalidates the fragments.
 *
 * Only runs on preference/procedural beliefs about the owner —
 * factual identity beliefs and third-party beliefs are left alone.
 */
export async function consolidateProfile(
  storage: Storage,
  llm: LLMClient,
  logger?: Logger,
): Promise<ConsolidationResult> {
  const allBeliefs = listBeliefs(storage, "active");

  // Group preferences/procedural beliefs by theme
  const themes = new Map<string, Belief[]>();
  for (const belief of allBeliefs) {
    // Only consolidate owner preferences and procedural beliefs
    if (belief.subject !== "owner" && belief.subject !== "general") continue;
    if (belief.type !== "preference" && belief.type !== "procedural") continue;

    const theme = classifyTheme(belief.statement);
    if (!theme) continue;

    const list = themes.get(theme) ?? [];
    list.push(belief);
    themes.set(theme, list);
  }

  let themesProcessed = 0;
  let beliefsConsolidated = 0;
  let beliefsCreated = 0;

  for (const [theme, beliefs] of themes) {
    // Only consolidate themes with 3+ beliefs — small clusters aren't worth merging
    if (beliefs.length < 3) continue;

    const statements = beliefs.map((b) => b.statement);

    try {
      const result = await llm.chat([
        {
          role: "system",
          content:
            "You merge a set of related user preferences into ONE comprehensive statement. " +
            "Combine all the specific details into a single, dense sentence that captures everything. " +
            "Keep it factual and specific — no generic wisdom. Under 40 words. No quotes.",
        },
        {
          role: "user",
          content: `Merge these ${beliefs.length} related preferences into one statement:\n${statements.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        },
      ], {
        temperature: 0.2,
        telemetry: { process: "memory.consolidate" },
      });

      const merged = result.text.trim();
      if (!merged || merged.length < 10) continue;

      // Calculate consolidated confidence — sum of evidence, capped at 0.95
      const totalConfidence = Math.min(0.95, beliefs.reduce((sum, b) => sum + b.confidence, 0) / beliefs.length + 0.2);
      const totalAccess = beliefs.reduce((sum, b) => sum + b.access_count, 0);

      // Create the consolidated belief
      const created = await rememberStructured(storage, llm, {
        statement: merged,
        factType: "preference",
        importance: 8,
        subject: "owner",
      }, logger, {
        origin: "synthesized",
      });

      // Boost the new belief's confidence and access count
      storage.run(
        "UPDATE beliefs SET confidence = ?, access_count = ?, stability = 3.0 WHERE id = ?",
        [totalConfidence, totalAccess, created.beliefIds[0]],
      );

      // Invalidate the fragments
      for (const old of beliefs) {
        storage.run(
          "UPDATE beliefs SET status = 'invalidated', correction_state = 'invalidated', updated_at = datetime('now') WHERE id = ? AND status = 'active'",
          [old.id],
        );
      }

      beliefsConsolidated += beliefs.length;
      beliefsCreated++;
      themesProcessed++;

      logger?.info(`Profile consolidation: merged ${beliefs.length} "${theme}" beliefs into: "${merged}"`);
    } catch (err) {
      logger?.warn(`Profile consolidation failed for theme "${theme}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { themesProcessed, beliefsConsolidated, beliefsCreated };
}
