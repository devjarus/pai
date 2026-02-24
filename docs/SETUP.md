# Setup Guide

Complete instructions for installing, configuring, and using Personal AI.

---

## Table of Contents

- [Option A: Docker (recommended)](#option-a-docker-recommended)
- [Option B: From Source (developers)](#option-b-from-source-developers)
- [LLM Provider Setup](#llm-provider-setup)
  - [Local Ollama](#local-ollama)
  - [Ollama Cloud](#ollama-cloud)
  - [OpenAI](#openai)
  - [Anthropic](#anthropic)
  - [Google AI (Gemini)](#google-ai-gemini)
- [Telegram Bot Setup](#telegram-bot-setup)
- [Using Personal AI](#using-personal-ai)
  - [Chat](#chat)
  - [Memory](#memory)
  - [Knowledge Base](#knowledge-base)
  - [Tasks & Goals](#tasks--goals)
  - [Settings](#settings)
- [CLI Usage](#cli-usage)
- [Troubleshooting](#troubleshooting)

---

## Option A: Docker (recommended)

The fastest way to get started. Requires only [Docker](https://docs.docker.com/get-docker/) installed and running.

### One-click install

```bash
curl -fsSL https://raw.githubusercontent.com/devjarus/personal-ai/main/install.sh | bash
```

The script will:
1. Check that Docker and Docker Compose are available
2. Ask if you want **local** (Ollama) or **cloud** (OpenAI/Anthropic/Google) LLM
3. If cloud: prompt for provider choice and API key
4. Download `docker-compose.yml` to `~/.personal-ai/`
5. Pull and start the containers

Your LLM provider config is passed as Docker environment variables on first run. After startup, you can change everything from the **Settings** page — changes are saved to `~/.personal-ai/config.json` and take effect immediately.

When it finishes, open **http://localhost:3141**.

### Manual Docker commands

```bash
# Clone the repo (or just download docker-compose.yml)
git clone https://github.com/devjarus/pai.git
cd pai

# Option 1: Cloud provider only (no Ollama container)
docker compose up -d

# Option 2: With local Ollama sidecar
docker compose --profile local up -d

# Option 3: Pass provider config directly
PAI_LLM_PROVIDER=openai PAI_LLM_API_KEY=sk-... docker compose up -d
```

### Managing Docker

```bash
# Stop
docker compose down

# View logs
docker compose logs -f

# Update to latest version
docker compose pull && docker compose up -d

# Reset data (delete everything)
docker compose down -v
```

### Data persistence

Your data is stored at `~/.personal-ai/data/` on the host, mounted into the container at `/data`. This persists across container restarts and upgrades.

---

## Option C: Railway (cloud deployment)

Deploy pai to [Railway](https://railway.app) for always-on cloud access.

### Step 1: Create a Railway project

1. Fork or push the repo to your GitHub account
2. Go to [railway.app](https://railway.app) and create a new project
3. Select **Deploy from GitHub repo** and choose your pai repository

### Step 2: Add a persistent volume

Railway has an ephemeral filesystem — your SQLite database needs a volume:

1. In your Railway service, go to **Settings > Volumes**
2. Add a volume with mount path `/data`

### Step 3: Set environment variables

In the Railway service settings, add these variables:

| Variable | Value | Required |
|----------|-------|----------|
| `PAI_AUTH_TOKEN` | A strong random token (32+ chars) | Yes |
| `PAI_LLM_PROVIDER` | `openai`, `anthropic`, or `google` | Yes |
| `PAI_LLM_API_KEY` | Your provider API key | Yes |
| `PAI_LLM_MODEL` | e.g. `gpt-4o`, `claude-sonnet-4-20250514` | Recommended |
| `PAI_DATA_DIR` | `/data` | Yes |
| `PAI_CORS_ORIGIN` | Your custom domain (e.g. `https://pai.example.com`) | If using custom domain |
| `PAI_TELEGRAM_TOKEN` | Telegram bot token | Optional |

> **Important:** `PAI_AUTH_TOKEN` is required. The server will refuse to start without it when exposed publicly. Generate one with: `openssl rand -hex 32`

### Step 4: Deploy

Railway auto-deploys on push. The `railway.toml` in the repo configures the build and health check automatically.

### Step 5: Access your instance

1. Railway assigns a URL like `https://pai-production-xxxx.up.railway.app`
2. Or add a custom domain in Railway settings
3. All API requests require the auth token as a Bearer token:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" https://your-app.up.railway.app/api/stats
   ```
4. The web UI served at the root URL includes the token in requests automatically when you set it in the browser

### Security notes

- All traffic is encrypted via Railway's HTTPS termination
- The server adds security headers (helmet): CSP, HSTS, X-Frame-Options, etc.
- Rate limiting is enforced: 100 req/min global, 20 req/min for chat, 10 req/min for knowledge learning
- Authentication uses timing-safe comparison to prevent timing attacks
- The Docker container runs as a non-root user

---

## Option B: From Source (developers)

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- An LLM provider (local Ollama or a cloud API key)

### Install and run

```bash
git clone https://github.com/devjarus/pai.git
cd pai
pnpm install
pnpm build

pnpm start                # start server → http://127.0.0.1:3141
pnpm stop                 # stop server
```

### Development mode

```bash
pnpm dev                  # build + start server
pnpm dev:ui               # vite dev server with hot reload (proxies API to :3141)
```

---

## LLM Provider Setup

Personal AI needs an LLM for chat and embeddings. You can configure the provider in the **Settings** page at http://localhost:3141 or via environment variables.

### Local Ollama

Best for: privacy, no API costs, offline use.

1. Install [Ollama](https://ollama.ai/)
2. Pull a model:
   ```bash
   ollama pull llama3.2
   ollama pull nomic-embed-text
   ```
3. Ollama runs at `http://localhost:11434` by default — no API key needed.

**Settings:**

| Field | Value |
|-------|-------|
| Provider | `ollama` |
| Base URL | `http://localhost:11434` |
| Model | `llama3.2` (or any model you pulled) |
| Embed Model | `nomic-embed-text` |
| API Key | _(leave empty)_ |

> **With Docker:** Use `docker compose --profile local up -d` to start Ollama alongside pai. The compose file pre-configures the connection.

---

### Ollama Cloud

Best for: running Ollama models without local GPU, pay-per-use.

1. Sign up at [ollama.com](https://ollama.com)
2. Go to **Settings > API Keys** and create a new key
3. Note: Ollama Cloud hosts the same models as local Ollama (llama3.2, qwen, deepseek, etc.)

**Settings:**

| Field | Value |
|-------|-------|
| Provider | `ollama` |
| Base URL | `https://ollama.com` |
| Model | `llama3.2` (or any available cloud model) |
| Embed Model | `nomic-embed-text` |
| API Key | your Ollama Cloud API key |

**Environment variables:**
```bash
PAI_LLM_PROVIDER=ollama
PAI_LLM_BASE_URL=https://ollama.com
PAI_LLM_MODEL=llama3.2
PAI_LLM_EMBED_MODEL=nomic-embed-text
PAI_LLM_API_KEY=your-api-key
```

> **Important:** The base URL must be `https://ollama.com` (not `https://ollama.com/api` — the SDK appends `/api/` automatically).

---

### OpenAI

1. Get an API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

**Settings:**

| Field | Value |
|-------|-------|
| Provider | `openai` |
| Base URL | `https://api.openai.com/v1` |
| Model | `gpt-4o` (or `gpt-4o-mini` for lower cost) |
| Embed Model | `text-embedding-3-small` |
| API Key | `sk-...` |

---

### Anthropic

1. Get an API key from [console.anthropic.com](https://console.anthropic.com/)

**Settings:**

| Field | Value |
|-------|-------|
| Provider | `anthropic` |
| Base URL | `https://api.anthropic.com` |
| Model | `claude-sonnet-4-20250514` |
| Embed Model | _(leave empty — falls back to local embeddings)_ |
| API Key | `sk-ant-...` |

> **Note:** Anthropic does not offer an embedding API. pai will automatically use local embeddings via `@huggingface/transformers` (downloaded on first use, ~30MB) or you can set Embed Provider to `ollama` or `openai` separately.

---

### Google AI (Gemini)

1. Get an API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

**Settings:**

| Field | Value |
|-------|-------|
| Provider | `google` |
| Base URL | `https://generativelanguage.googleapis.com/v1beta` |
| Model | `gemini-2.0-flash` (or `gemini-1.5-pro`) |
| Embed Model | `text-embedding-004` |
| API Key | `AIza...` |

---

## Telegram Bot Setup

Chat with your Personal AI from Telegram — same assistant, same memory, same tools.

### Step 1: Create a bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g., "My Personal AI")
4. Choose a username (e.g., `my_pai_bot`)
5. BotFather gives you a token like `7123456789:AAF...`

### Step 2: Configure

**Option A — Via Settings UI:**

1. Open http://localhost:3141 and go to **Settings**
2. Scroll to the Telegram section
3. Paste your bot token
4. Set your Telegram username as the owner (e.g., `yourusername`)
5. Save — the bot starts automatically

**Option B — Via environment variable:**

```bash
# Add to your shell profile or .env file
export PAI_TELEGRAM_TOKEN=7123456789:AAF...

# Restart the server
pnpm stop && pnpm start
```

**Option C — Standalone (without the web server):**

```bash
pnpm build
PAI_TELEGRAM_TOKEN=7123456789:AAF... node packages/plugin-telegram/dist/index.js
```

**Option D — With Docker:**

```bash
# Pass token as environment variable
PAI_TELEGRAM_TOKEN=7123456789:AAF... docker compose up -d
```

Or add it to `~/.personal-ai/.env`:
```
PAI_TELEGRAM_TOKEN=7123456789:AAF...
```

### Step 3: Chat

Open your bot in Telegram and send any message. The bot responds using the same assistant pipeline as the web UI — it has access to memory, web search, tasks, and knowledge.

### Telegram commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | List available commands |
| `/clear` | Clear conversation history |
| `/tasks` | Show open tasks |
| `/memories` | Show top 10 memories |

Or just send any text message to chat naturally.

### Multi-user support

The bot knows who's talking:
- **Owner** (configured via `ownerUsername`) — memories attributed to "owner"
- **Others** — memories attributed by their Telegram name (e.g., "Alex prefers...")

Each Telegram chat gets its own conversation thread, persisted in the database.

---

## Using Personal AI

### Chat

The **Chat** page is your main interface. Send messages and the assistant will:

- **Recall memories** — automatically searches your memory before answering
- **Search the web** — uses Brave Search when you ask about current events
- **Manage tasks** — create, list, complete tasks via natural language
- **Learn from URLs** — paste a link and ask it to learn from the page
- **Remember things** — facts you share are automatically extracted and stored

**Thread sidebar:** Click the sidebar icon to see past conversations. Each thread is saved and searchable.

**Token usage:** A small badge below assistant messages shows input/output token counts.

**Tool cards:** When the assistant uses tools (memory recall, web search, etc.), you'll see expandable cards showing what it did.

### Memory

The **Memory Explorer** page lets you browse everything your AI has learned about you.

- **Browse** beliefs by type: factual, preference, procedural, architectural, insight, meta
- **Filter** by status: active, invalidated, forgotten, pruned
- **Search** semantically — type a query and get the most relevant beliefs
- **View details** — click a belief to see confidence, stability, importance, creation date, and linked episodes
- **Delete** beliefs you want forgotten

**How memory works:**

When you chat, the assistant extracts facts from your messages and stores them as "beliefs." Over time:

- Repeated information **reinforces** beliefs (higher confidence)
- Contradictory information **weakens or replaces** old beliefs
- Unused beliefs **decay** over time (30-day half-life)
- Related beliefs are **linked** in a knowledge graph
- You can run `reflect` to find duplicates and `synthesize` to create higher-level insights

### Knowledge Base

The **Knowledge** page lets you build a personal knowledge base from web pages.

1. Click **Learn from URL** and paste a link
2. pai fetches the page, extracts content, splits into chunks, and stores with embeddings
3. When you chat, the assistant can search your knowledge base for relevant information

You can also:
- Browse all learned sources
- View individual chunks
- Search across all knowledge
- Re-learn a page (refresh content)
- Crawl sub-pages from a source

### Tasks & Goals

Manage your to-do list through chat or the CLI:

- **"Add a task: finish the report by Friday"** — the assistant creates it
- **"What should I work on?"** — AI-powered prioritization using your tasks + memory context
- **"Mark the report task as done"** — completes it

Tasks have: title, description, status, priority (low/medium/high), due date, and optional goal.

### Settings

The **Settings** page lets you configure:

- **LLM Provider** — select from dropdown (Ollama, OpenAI, Anthropic, Google AI). Selecting a provider auto-fills sensible defaults for base URL, model, and embed model.
- **Model** — chat model name
- **Base URL** — provider endpoint
- **API Key** — your provider API key (stored locally, never sent to pai servers)
- **Embed Model** — model used for semantic search
- **Data Directory** — where your database lives (default: `~/.personal-ai/data/`)

Changes take effect immediately — no restart needed.

---

## CLI Usage

After building (`pnpm build`), use `pnpm pai <command>` or link globally:

```bash
pnpm -C packages/cli link --global    # then use `pai` directly
```

### Memory

```bash
pai memory remember "I prefer dark mode in all editors"
pai memory recall "editor preferences"
pai memory beliefs                     # list all beliefs
pai memory stats                       # memory health summary
pai memory reflect                     # find duplicates
pai memory synthesize                  # generate meta-beliefs
pai memory export backup.json          # backup
pai memory import backup.json          # restore
```

### Tasks

```bash
pai task add "Review PR #42" --priority high --due 2026-03-15
pai task list
pai task done <id>
pai task ai-suggest                    # AI prioritization
```

### Knowledge

```bash
pai knowledge learn "https://react.dev/learn"
pai knowledge search "hooks"
pai knowledge list
```

### Health check

```bash
pai health                             # test LLM connection
```

All commands support `--json` for structured output and prefix-matched IDs (first 8 characters).

---

## Troubleshooting

### "Cannot reach ollama" / Connection refused

- **Local Ollama:** Make sure Ollama is running (`ollama serve` or the Ollama app)
- **Docker with Ollama:** Use `docker compose --profile local up -d` (not just `docker compose up -d`)
- **Ollama Cloud:** Verify base URL is `https://ollama.com` (not `http://localhost:11434`)

### "Invalid API key"

- Check the API key in Settings — make sure there are no extra spaces
- For Ollama Cloud: generate a new key at [ollama.com settings](https://ollama.com/settings)
- For OpenAI: check at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

### "Model not found"

- **Ollama (local):** Pull the model first: `ollama pull llama3.2`
- **Ollama Cloud:** Not all local models are available on cloud — check [ollama.com/library](https://ollama.com/library)
- **OpenAI/Google:** Verify the exact model name (e.g., `gpt-4o` not `gpt4o`)

### Telegram bot not responding

- Only one instance can poll at a time. Stop any other running instances.
- Check the token is correct: `curl https://api.telegram.org/bot<TOKEN>/getMe`
- If using Docker, pass the token: `PAI_TELEGRAM_TOKEN=... docker compose up -d`

### Embeddings not working

- **Ollama:** Make sure you pulled an embedding model: `ollama pull nomic-embed-text`
- **Anthropic:** Doesn't have an embedding API — set Embed Provider to `ollama`, `openai`, or `local`
- **Local fallback:** First run downloads ~30MB model. Check logs if it fails: `cat ~/.personal-ai/data/pai.log`

### Server won't start (port 3141 in use)

```bash
# Find what's using the port
lsof -i :3141

# Kill it
pnpm stop
# or
kill $(lsof -t -i :3141)
```

### Reset everything

```bash
# Delete all data (memories, knowledge, threads, tasks)
rm -rf ~/.personal-ai/data/personal-ai.db

# Or with Docker
docker compose down -v
```

Your data is in a single SQLite file at `~/.personal-ai/data/personal-ai.db`. Back it up before resetting.
