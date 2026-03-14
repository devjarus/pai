/**
 * Build provider-specific context management options for streamText/generateText.
 *
 * - Anthropic: auto-compaction + tool-use clearing at 85% of context window
 * - OpenAI: auto-truncation
 * - Others (Ollama, Google, Cerebras): rely on adaptive message loading only
 */
export function getProviderOptions(provider: string, contextWindow: number): Record<string, Record<string, unknown>> | undefined {
  const triggerTokens = Math.floor(contextWindow * 0.85);
  switch (provider) {
    case "anthropic":
      return {
        anthropic: {
          contextManagement: {
            edits: [
              {
                type: "clear_tool_uses_20250919" as const,
                trigger: { type: "input_tokens" as const, value: triggerTokens },
                keep: { type: "tool_uses" as const, value: 3 },
              },
              {
                type: "compact_20260112" as const,
                trigger: { type: "input_tokens" as const, value: triggerTokens },
              },
            ],
          },
        },
      };
    case "openai":
      return { openai: { truncation: "auto" as const } };
    default:
      return undefined;
  }
}

/** Whether the provider has native context management (auto-compaction or truncation). */
export function hasNativeContextManagement(provider: string): boolean {
  return provider === "anthropic" || provider === "openai";
}

/**
 * Trim messages to fit within a token budget for providers that lack native
 * context management (Ollama, Google, Cerebras).
 *
 * Strategy:
 * - Always keeps the first message (system prompt) and the last message (current user input).
 * - Drops oldest middle messages until estimated tokens fit within the budget.
 * - Uses a conservative estimate of 1 token per 4 characters.
 *
 * For providers with native context management this is a no-op.
 */
export function trimMessagesForBudget<T extends { role: string; content: string }>(
  messages: T[],
  provider: string,
  contextWindow: number,
): T[] {
  if (hasNativeContextManagement(provider)) return messages;
  if (messages.length <= 2) return messages;

  // Reserve 85% of context for input (matching Anthropic trigger), leave room for output
  const inputBudget = Math.floor(contextWindow * 0.85);
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens <= inputBudget) return messages;

  // Keep first (system) and last (current input), trim from the oldest middle messages
  const first = messages[0]!;
  const last = messages[messages.length - 1]!;
  const middle = messages.slice(1, -1);

  let currentTokens = estimateTokens(first.content) + estimateTokens(last.content);
  const kept: T[] = [];

  // Walk from newest to oldest in the middle, keeping as many recent messages as fit
  for (let i = middle.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(middle[i]!.content);
    if (currentTokens + msgTokens > inputBudget) break;
    currentTokens += msgTokens;
    kept.unshift(middle[i]!);
  }

  return [first, ...kept, last];
}
