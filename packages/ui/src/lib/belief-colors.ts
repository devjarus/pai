/** Shared color classes for belief/memory types — used by BeliefCard, Memory page, etc. */
export const typeColorMap: Record<string, string> = {
  factual: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  preference: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  procedural: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  architectural: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  insight: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  meta: "bg-pink-500/15 text-pink-400 border-pink-500/30",
};

/** Left-border accent color for each belief type */
export const typeBorderLeftMap: Record<string, string> = {
  factual: "border-l-blue-500/50",
  preference: "border-l-purple-500/50",
  procedural: "border-l-emerald-500/50",
  architectural: "border-l-orange-500/50",
  insight: "border-l-amber-500/50",
  meta: "border-l-pink-500/50",
};

/** Solid dot/indicator color for each belief type */
export const typeDotMap: Record<string, string> = {
  factual: "bg-blue-500",
  preference: "bg-purple-500",
  procedural: "bg-emerald-500",
  architectural: "bg-orange-500",
  insight: "bg-amber-500",
  meta: "bg-pink-500",
};
