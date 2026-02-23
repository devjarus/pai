import type { Storage } from "../types.js";
import { listBeliefs } from "./memory.js";
import { effectiveConfidence } from "./memory.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const TYPE_HEADINGS: Record<string, string> = {
  preference: "Preferences — always follow these",
  procedural: "Procedures — follow these steps",
  architectural: "Architecture — respect these decisions",
  factual: "Project Facts — respect these constraints",
  meta: "Principles — these override specific beliefs",
  insight: "Insights — apply when relevant",
};

const TYPE_ORDER = ["meta", "preference", "architectural", "procedural", "factual", "insight"];

export function generateMemoryFile(
  storage: Storage,
  outputPath: string,
  options?: { maxBeliefs?: number; minConfidence?: number },
): { beliefCount: number; path: string } {
  const max = options?.maxBeliefs ?? 25;
  const minConf = options?.minConfidence ?? 0.3;

  const beliefs = listBeliefs(storage, "active");
  const top = beliefs
    .filter((b) => effectiveConfidence(b) > minConf)
    .sort((a, b) => effectiveConfidence(b) - effectiveConfidence(a))
    .slice(0, max);

  if (top.length === 0) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "<!-- No established beliefs yet -->\n");
    return { beliefCount: 0, path: outputPath };
  }

  const grouped: Record<string, typeof top> = {};
  for (const b of top) {
    const type = b.type || "insight";
    if (!grouped[type]) grouped[type] = [];
    grouped[type]!.push(b);
  }

  let md = "# Memory\n\n";
  md += "These are established facts and preferences learned from past sessions. Follow them.\n\n";

  for (const type of TYPE_ORDER) {
    const items = grouped[type];
    if (!items?.length) continue;
    const heading = TYPE_HEADINGS[type] ?? type;
    md += `## ${heading}\n`;
    for (const b of items) {
      md += `- ${b.statement}\n`;
    }
    md += "\n";
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, md);
  return { beliefCount: top.length, path: outputPath };
}
