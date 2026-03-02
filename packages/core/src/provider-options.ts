/**
 * Build provider-specific context management options for streamText/generateText.
 *
 * - Anthropic: auto-compaction + tool-use clearing at 85% of context window
 * - OpenAI: auto-truncation
 * - Others (Ollama, Google): rely on adaptive message loading only
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
