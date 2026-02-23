import type { ChatMessage, LLMClient, Storage, Logger } from "../types.js";
import { createEpisode, storeEpisodeEmbedding } from "./memory.js";

const MIN_TURNS_TO_CONSOLIDATE = 4;

const CONSOLIDATION_PROMPT = `You are a memory consolidation engine. Given a conversation chunk, write a concise 1-3 sentence summary capturing the key topics discussed, decisions made, and any personal facts revealed.

Rules:
- Focus on WHAT was discussed and decided, not greetings or filler
- Include names and specific details (technologies, places, preferences)
- Write in third person: "The user discussed..." or "Alex decided..."
- If the conversation is trivial small talk with nothing worth remembering, reply with exactly "NONE"

Summary:`;

export interface ConsolidationResult {
  episodeId: string;
  summary: string;
}

export async function consolidateConversation(
  storage: Storage,
  llm: LLMClient,
  turns: ChatMessage[],
  logger?: Logger,
): Promise<ConsolidationResult | null> {
  if (turns.length < MIN_TURNS_TO_CONSOLIDATE) return null;

  const formatted = turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n");

  const result = await llm.chat([
    { role: "system", content: CONSOLIDATION_PROMPT },
    { role: "user", content: formatted },
  ], { temperature: 0.3 });

  const summary = result.text.trim();
  if (!summary || summary === "NONE" || summary.startsWith("NONE")) return null;

  const episode = createEpisode(storage, {
    action: summary,
    context: "conversation-consolidation",
  });

  try {
    const { embedding } = await llm.embed(summary);
    storeEpisodeEmbedding(storage, episode.id, embedding);
  } catch {
    logger?.warn("Failed to embed consolidated episode", { episodeId: episode.id });
  }

  logger?.info("Conversation consolidated", { episodeId: episode.id, turnCount: turns.length });

  return { episodeId: episode.id, summary };
}
