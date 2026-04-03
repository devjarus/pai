import type { AgentPlugin, PluginContext } from "@personal-ai/core";
import { semanticSearch, knowledgeSearch, getContextBudget, getProviderOptions, instrumentedGenerateText } from "@personal-ai/core";
import type { LanguageModel } from "ai";
import type { Api } from "grammy";
import type { RawApi } from "grammy";
import {
  markdownToTelegramHTML,
  splitMessage,
  isComplexContent,
  buildTelegramDigestMarkdown,
  formatTelegramResponse,
} from "./formatter.js";

// --- In-memory group context ---

interface GroupContext {
  lastReactionTime: number;
  lastProactiveTime: number;
  recentMessages: Array<{ text: string; sender: string; timestamp: number }>;
}

const groupContexts = new Map<number, GroupContext>();

const RELEVANCE_REACT_THRESHOLD = 0.65;
const RELEVANCE_PROACTIVE_THRESHOLD = 0.78;
const BUFFER_SIZE = 50;
const DEFAULT_PROACTIVE_COOLDOWN_MIN = 24 * 60;

function isSameUtcDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

// Telegram-allowed reaction emoji for non-premium bots
const ALLOWED_REACTIONS = ["👍", "❤️", "🔥", "👏", "😁", "🎉", "😢", "🤔", "👎", "🤯", "😱", "💯", "😍", "🙏", "👀", "🤡", "🥰", "🤗", "🫡", "💔", "🥱", "😡"] as const;

function getGroupContext(chatId: number): GroupContext {
  let gc = groupContexts.get(chatId);
  if (!gc) {
    gc = { lastReactionTime: 0, lastProactiveTime: 0, recentMessages: [] };
    groupContexts.set(chatId, gc);
  }
  return gc;
}

/** Always called for non-mentioned group messages. Zero API cost. */
export function bufferMessage(chatId: number, text: string, sender: string): void {
  const gc = getGroupContext(chatId);
  gc.recentMessages.push({ text, sender, timestamp: Date.now() });
  if (gc.recentMessages.length > BUFFER_SIZE) {
    gc.recentMessages.shift();
  }
}

type EngageResult = "react" | "proactive" | "ignore";

/** Embedding-based relevance check against memory and knowledge. */
async function shouldEngage(
  ctx: PluginContext,
  chatId: number,
  text: string,
): Promise<{ result: EngageResult; score: number }> {
  if (text.length < 10) return { result: "ignore", score: 0 };

  const gc = getGroupContext(chatId);
  const now = Date.now();
  const reactionCooldown = (ctx.config.telegram?.reactionCooldownMin ?? 3) * 60 * 1000;
  const proactiveCooldown = (ctx.config.telegram?.proactiveCooldownMin ?? DEFAULT_PROACTIVE_COOLDOWN_MIN) * 60 * 1000;
  const alreadyPostedToday = gc.lastProactiveTime > 0 && isSameUtcDay(gc.lastProactiveTime, now);

  const canReact = now - gc.lastReactionTime >= reactionCooldown;
  const canPost = !alreadyPostedToday && (now - gc.lastProactiveTime >= proactiveCooldown);
  if (!canReact && !canPost) return { result: "ignore", score: 0 };

  // Single embedding call
  const { embedding } = await ctx.llm.embed(text, {
    telemetry: {
      process: "embed.memory",
      surface: "telegram",
      chatId,
    },
  });

  // Search memory
  const memoryResults = semanticSearch(ctx.storage, embedding, 3, text);
  const topMemoryScore = memoryResults.length > 0 ? memoryResults[0]!.similarity : 0;

  // Search knowledge (reuse embedding)
  let topKnowledgeScore = 0;
  try {
    const knowledgeResults = await knowledgeSearch(ctx.storage, ctx.llm, text, 3, { queryEmbedding: embedding });
    topKnowledgeScore = knowledgeResults.length > 0 ? knowledgeResults[0]!.score : 0;
  } catch {
    // Knowledge search may fail if no sources exist
  }

  const bestScore = Math.max(topMemoryScore, topKnowledgeScore);

  if (canPost && bestScore >= RELEVANCE_PROACTIVE_THRESHOLD) {
    return { result: "proactive", score: bestScore };
  }
  // Keep active group chats warm once per day even when semantic relevance is low.
  // This enables lightweight "interesting topic" nudges that don't depend on memory matches.
  if (canPost && gc.recentMessages.length >= 3) {
    return { result: "proactive", score: bestScore };
  }
  if (canReact && bestScore >= RELEVANCE_REACT_THRESHOLD) {
    return { result: "react", score: bestScore };
  }
  return { result: "ignore", score: bestScore };
}

/** Ask the LLM to pick an appropriate reaction emoji based on message context. */
async function pickReactionEmoji(
  ctx: PluginContext,
  messageText: string,
): Promise<string> {
  try {
    const emojiBudget = getContextBudget(ctx.config.llm.provider, ctx.config.llm.model, ctx.config.llm.contextWindow);
    const { result } = await instrumentedGenerateText(
      { storage: ctx.storage, logger: ctx.logger },
      {
        model: ctx.llm.getModel() as LanguageModel,
        system: `You are an emoji picker. Given a message, respond with exactly ONE emoji that best fits as a reaction. Choose from: ${ALLOWED_REACTIONS.join(" ")}

Rules:
- Respond with ONLY the emoji, nothing else.
- Match the emotion/tone of the message.
- 👍 for agreement/approval, ❤️ for wholesome/love, 🔥 for impressive/cool, 👏 for achievements, 😁 for funny, 🎉 for celebrations, 🤔 for thought-provoking, 💯 for strong agreement, 😍 for amazing things, 🙏 for grateful/helpful, 👀 for interesting/curious, 🤯 for mind-blowing, 😱 for shocking, 🫡 for respect.`,
        messages: [{ role: "user", content: messageText }],
        temperature: 0.5,
        maxRetries: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerOptions: getProviderOptions(ctx.config.llm.provider, emojiBudget.contextWindow) as any,
      },
      {
        spanType: "llm",
        process: "telegram.passive",
        surface: "telegram",
        provider: ctx.config.llm.provider,
        model: ctx.config.llm.model,
        requestSizeChars: messageText.length,
      },
    );
    const emoji = result.text.trim();
    // Validate it's an allowed emoji, fallback to 👍
    if (ALLOWED_REACTIONS.includes(emoji as typeof ALLOWED_REACTIONS[number])) {
      return emoji;
    }
    // Try to find an allowed emoji within the response
    for (const allowed of ALLOWED_REACTIONS) {
      if (emoji.includes(allowed)) return allowed;
    }
    return "👍";
  } catch {
    return "👍";
  }
}

/** Generate a proactive response using recent group context. */
async function generateProactiveResponse(
  ctx: PluginContext,
  _agentPlugin: AgentPlugin,
  chatId: number,
): Promise<string | null> {
  const gc = getGroupContext(chatId);
  const recent = gc.recentMessages.slice(-10);
  if (recent.length === 0) return null;

  const conversationContext = recent
    .map((m) => `[${m.sender}]: ${m.text}`)
    .join("\n");

  const systemPrompt = `You are a friendly AI assistant in a group chat. You're observing the conversation and can chime in when you have something useful, interesting, or fun to add.

Rules:
- If you have nothing to add, respond with exactly "SKIP".
- Keep responses brief (1-3 sentences).
- Be natural, casual, and conversational.
- Prefer sharing one interesting related topic, fun fact, or thoughtful question that helps keep the group active.
- You can share relevant knowledge, make a witty observation, ask a follow-up question, or offer a helpful suggestion.
- Do not announce yourself or explain why you're speaking.
- Do not repeat what was already said.
- Match the energy of the conversation — be playful if they're playful, serious if they're serious.`;

  const chimeBudget = getContextBudget(ctx.config.llm.provider, ctx.config.llm.model, ctx.config.llm.contextWindow);
  const prompt = `Recent group conversation:\n${conversationContext}\n\nChime in if you have something valuable or interesting to add. Otherwise say SKIP.`;
  const { result } = await instrumentedGenerateText(
    { storage: ctx.storage, logger: ctx.logger },
    {
      model: ctx.llm.getModel() as LanguageModel,
      system: systemPrompt,
      messages: [
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      maxRetries: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: getProviderOptions(ctx.config.llm.provider, chimeBudget.contextWindow) as any,
    },
    {
      spanType: "llm",
      process: "telegram.passive",
      surface: "telegram",
      chatId,
      provider: ctx.config.llm.provider,
      model: ctx.config.llm.model,
      requestSizeChars: prompt.length,
    },
  );

  const text = result.text.trim();
  if (!text || text === "SKIP" || text.length < 5) return null;
  return text;
}

/**
 * Process a non-mentioned group message passively.
 * Called fire-and-forget from the bot handler.
 */
export async function passiveProcess(
  ctx: PluginContext,
  agentPlugin: AgentPlugin,
  chatId: number,
  message: { message_id: number; text?: string },
  api: Api<RawApi>,
): Promise<void> {
  if (!ctx.config.telegram?.passiveListening) return;
  if (!message.text) return;

  const { result, score } = await shouldEngage(ctx, chatId, message.text);
  ctx.logger.debug("Passive engagement check", { chatId, result, score: score.toFixed(3) });

  if (result === "ignore") return;

  const gc = getGroupContext(chatId);

  if (result === "react" || result === "proactive") {
    // Let the LLM pick a contextually appropriate emoji
    const emoji = await pickReactionEmoji(ctx, message.text);
    await api.setMessageReaction(chatId, message.message_id, [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: "emoji", emoji } as any,
    ]).catch(() => {});
    gc.lastReactionTime = Date.now();
    ctx.logger.debug("Passive reaction", { chatId, emoji });
  }

  if (result === "proactive") {
    const response = await generateProactiveResponse(ctx, agentPlugin, chatId);
    if (response) {
      const normalizedResponse = formatTelegramResponse(response);
      const inlineMarkdown = isComplexContent(normalizedResponse)
        ? buildTelegramDigestMarkdown(normalizedResponse)
        : normalizedResponse;
      const html = markdownToTelegramHTML(inlineMarkdown);
      const parts = splitMessage(html);
      for (let i = 0; i < parts.length; i++) {
        await api.sendMessage(chatId, parts[i]!, {
          parse_mode: "HTML",
          ...(i === 0 ? { reply_parameters: { message_id: message.message_id } } : {}),
        }).catch(() => {
          // Fallback: send without HTML formatting
          api.sendMessage(chatId, response, {
            ...(i === 0 ? { reply_parameters: { message_id: message.message_id } } : {}),
          }).catch(() => {});
        });
      }
      gc.lastProactiveTime = Date.now();
    }
  }
}
