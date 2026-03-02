import { getContextWindow } from "tokenlens";

const PROVIDER_DEFAULTS: Record<string, number> = {
  ollama: 200_000,
  openai: 128_000,
  anthropic: 200_000,
  google: 1_000_000,
};

export interface ContextBudget {
  contextWindow: number;
  /** ~50% of context window, in tokens */
  historyBudget: number;
  /** historyBudget / 200 (avg msg tokens), clamped 4–100 */
  maxMessages: number;
}

let cachedBudget: { key: string; budget: ContextBudget } | null = null;

/**
 * Resolve context window size for the given provider/model.
 *
 * Resolution order:
 * 1. `contextWindow` override (from config or PAI_CONTEXT_WINDOW env)
 * 2. TokenLens static catalog (337+ cloud models)
 * 3. Provider defaults (ollama=200K, openai=128K, anthropic=200K, google=1M)
 * 4. Fallback: 8,192
 */
export function getContextBudget(
  provider: string,
  model: string,
  contextWindowOverride?: number,
): ContextBudget {
  const key = `${provider}/${model}/${contextWindowOverride ?? "auto"}`;
  if (cachedBudget?.key === key) return cachedBudget.budget;

  let contextWindow: number;

  if (contextWindowOverride && contextWindowOverride > 0) {
    // Explicit override from config — trust the user
    contextWindow = contextWindowOverride;
  } else {
    try {
      const ctx = getContextWindow(`${provider}/${model}`);
      contextWindow = ctx.totalMax ?? ctx.combinedMax ?? PROVIDER_DEFAULTS[provider] ?? 8_192;
    } catch {
      contextWindow = PROVIDER_DEFAULTS[provider] ?? 8_192;
    }
  }

  const historyBudget = Math.floor(contextWindow * 0.5);
  const maxMessages = Math.max(4, Math.min(100, Math.floor(historyBudget / 200)));
  const budget: ContextBudget = { contextWindow, historyBudget, maxMessages };
  cachedBudget = { key, budget };
  return budget;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Reset cached budget (for testing) */
export function _resetBudgetCache(): void {
  cachedBudget = null;
}
