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

  return `\n\nPREVIOUS RESEARCH FINDINGS (build on these, don't repeat):\n${summaries}\n\nFocus on what is NEW or CHANGED since the last research.`;
}
