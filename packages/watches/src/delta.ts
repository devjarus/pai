import type { Storage } from "@personal-ai/core";
import { listFindingsForWatch } from "@personal-ai/library";

/**
 * Build a context string summarising recent Library findings for a watch,
 * so that the next research run can build on prior results instead of
 * repeating them.
 */
export function getPreviousFindingsContext(storage: Storage, watchId: string, limit = 3): string {
  const findings = listFindingsForWatch(storage, watchId);
  if (findings.length === 0) return "";

  const recent = findings.slice(0, limit);
  const summaries = recent.map((f, i) => `${i + 1}. [${f.createdAt}] ${f.summary}`).join("\n");

  return `\n\nPREVIOUS RESEARCH (baseline — go beyond this):\n${summaries}\n\nUse different search queries than before. Seek new sources, updated data, fresh perspectives, or developments the previous research didn't cover.`;
}
