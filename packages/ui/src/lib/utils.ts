import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Clean a digest/research title — strip enrichment context and LLM preamble */
export function cleanDigestTitle(goal: string | undefined): string {
  if (!goal) return "Research Report";
  // Strip enrichment context appended by buildEnrichedResearchGoal
  let clean = goal.split(/\n\n(?:CONTEXT|IMPORTANT|PREVIOUS RESEARCH)/)[0]?.trim() ?? goal;
  // Strip LLM preamble patterns
  clean = clean
    .replace(/^(Based on|I'll|I will|Let me|Here('s| is)|I can|I apologize|I was unable)[^.]*\.\s*/i, "")
    .replace(/^Research (and compile|this topic)[^:]*:\s*/i, "")
    .trim();
  // Cap length
  if (clean.length > 100) clean = clean.slice(0, 97) + "...";
  return clean || "Research Report";
}

/** Strip markdown formatting for plain-text display contexts */
export function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
