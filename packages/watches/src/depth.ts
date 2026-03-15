export interface DepthConfig {
  level: "quick" | "standard" | "deep";
  maxAgents: number;
  maxSources: number;
  budgetMaxSearches: number;
  budgetMaxPages: number;
  description: string;
}

const configs: Record<DepthConfig["level"], DepthConfig> = {
  quick: {
    level: "quick",
    maxAgents: 1,
    maxSources: 3,
    budgetMaxSearches: 2,
    budgetMaxPages: 3,
    description: "Fast single-agent check with minimal source coverage",
  },
  standard: {
    level: "standard",
    maxAgents: 3,
    maxSources: 8,
    budgetMaxSearches: 5,
    budgetMaxPages: 8,
    description: "Balanced multi-agent research with moderate coverage",
  },
  deep: {
    level: "deep",
    maxAgents: 5,
    maxSources: 15,
    budgetMaxSearches: 10,
    budgetMaxPages: 15,
    description: "Thorough multi-agent deep dive with wide source coverage",
  },
};

/** Return the depth configuration for a given level. */
export function getDepthConfig(level: DepthConfig["level"]): DepthConfig {
  return { ...configs[level] };
}

/**
 * Resolve which depth level to use for a watch execution.
 *
 * If the watch carries an explicit depthLevel, that is used.
 * Manual triggers bump quick -> standard (the operator wants more than a glance).
 */
export function resolveDepthForWatch(
  watch: { depthLevel?: DepthConfig["level"] },
  isManualTrigger: boolean,
): DepthConfig {
  let level: DepthConfig["level"] = watch.depthLevel ?? "standard";

  if (isManualTrigger && level === "quick") {
    level = "standard";
  }

  return getDepthConfig(level);
}
