import type { LLMClient, ChatMessage, ChatOptions, Config } from "./types.js";

export function createLLMClient(llmConfig: Config["llm"]): LLMClient {
  const { provider, model, baseUrl, apiKey } = llmConfig;

  async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    if (provider === "ollama") {
      return chatOllama(baseUrl, model, messages, options);
    }
    return chatOpenAI(baseUrl, model, apiKey ?? "", messages, options);
  }

  async function health(): Promise<{ ok: boolean; provider: string }> {
    try {
      if (provider === "ollama") {
        const res = await fetch(`${baseUrl}/api/tags`);
        return { ok: res.ok, provider: "ollama" };
      }
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { ok: res.ok, provider: "openai" };
    } catch {
      return { ok: false, provider };
    }
  }

  return { chat, health };
}

async function chatOllama(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { message: { content: string } };
  return data.message.content;
}

async function chatOpenAI(
  baseUrl: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]!.message.content;
}
