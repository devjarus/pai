import http, { type Server } from "node:http";

const MOCK_RESPONSE = "Hello! I am your personal AI assistant.";
const EMBED_DIM = 384;

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Ollama /api/tags — model listing / health check */
function handleTags(res: http.ServerResponse) {
  jsonResponse(res, { models: [{ name: "mock-model" }] });
}

/** OpenAI-compatible /v1/chat/completions */
function handleChatCompletions(
  res: http.ServerResponse,
  body: Record<string, unknown>,
) {
  const stream = body.stream === true;

  if (!stream) {
    jsonResponse(res, {
      id: "mock-chat-1",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: MOCK_RESPONSE },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    });
    return;
  }

  // SSE streaming
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const words = MOCK_RESPONSE.split(" ");
  for (let i = 0; i < words.length; i++) {
    const content = i === 0 ? words[i] : ` ${words[i]}`;
    const chunk = {
      id: "mock-chat-1",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
        },
      ],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  // Final chunk with finish_reason
  const finalChunk = {
    id: "mock-chat-1",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
  res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

/** OpenAI-compatible /v1/embeddings */
function handleEmbeddings(res: http.ServerResponse) {
  jsonResponse(res, {
    object: "list",
    data: [
      {
        object: "embedding",
        index: 0,
        embedding: new Array(EMBED_DIM).fill(0),
      },
    ],
    model: "mock-model",
    usage: { prompt_tokens: 5, total_tokens: 5 },
  });
}

/** Ollama native /api/chat */
function handleOllamaChat(
  res: http.ServerResponse,
  body: Record<string, unknown>,
) {
  const stream = body.stream !== false; // Ollama defaults to streaming

  if (!stream) {
    jsonResponse(res, {
      model: "mock-model",
      created_at: new Date().toISOString(),
      message: { role: "assistant", content: MOCK_RESPONSE },
      done: true,
      total_duration: 100000000,
      eval_count: 8,
    });
    return;
  }

  // Ollama native streaming — newline-delimited JSON
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });

  const words = MOCK_RESPONSE.split(" ");
  for (let i = 0; i < words.length; i++) {
    const content = i === 0 ? words[i] : ` ${words[i]}`;
    res.write(
      JSON.stringify({
        model: "mock-model",
        created_at: new Date().toISOString(),
        message: { role: "assistant", content },
        done: false,
      }) + "\n",
    );
  }

  // Final done message
  res.write(
    JSON.stringify({
      model: "mock-model",
      created_at: new Date().toISOString(),
      message: { role: "assistant", content: "" },
      done: true,
      total_duration: 100000000,
      eval_count: 8,
    }) + "\n",
  );
  res.end();
}

/** Ollama native /api/embed or /api/embeddings */
function handleOllamaEmbed(res: http.ServerResponse) {
  jsonResponse(res, {
    model: "mock-model",
    embeddings: [new Array(EMBED_DIM).fill(0)],
  });
}

export function startMockLLM(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";

      // GET endpoints
      if (method === "GET" && url === "/api/tags") {
        handleTags(res);
        return;
      }

      // POST endpoints — collect body
      if (method === "POST") {
        let raw = "";
        req.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        req.on("end", () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(raw || "{}");
          } catch {
            // ignore parse errors, use empty body
          }

          if (url === "/v1/chat/completions") {
            handleChatCompletions(res, body);
          } else if (url === "/v1/embeddings") {
            handleEmbeddings(res);
          } else if (url === "/api/chat") {
            handleOllamaChat(res, body);
          } else if (url === "/api/embed" || url === "/api/embeddings") {
            handleOllamaEmbed(res);
          } else {
            jsonResponse(res, { error: "not found" }, 404);
          }
        });
        return;
      }

      // Fallback
      jsonResponse(res, { error: "not found" }, 404);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
