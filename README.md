# Personal AI

Local-first personal AI with plugin architecture. Memory + Tasks.

## Quick Start

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js task add "My first task"
node packages/cli/dist/index.js task list
```

## Commands

```
pai health                        Check LLM provider
pai memory remember <text>        Record observation, extract belief
pai memory recall <query>         Search beliefs
pai memory beliefs                List active beliefs
pai memory episodes               List recent episodes
pai task add <title>              Add task (--priority, --goal, --due)
pai task list                     List open tasks
pai task done <id>                Complete task
pai goal add <title>              Add goal
pai goal list                     List goals
pai task ai-suggest               AI task prioritization
```

## Config

Set via environment variables or `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| PAI_DATA_DIR | ~/.personal-ai | Data directory |
| PAI_LLM_PROVIDER | ollama | ollama or openai |
| PAI_LLM_MODEL | llama3.2 | Model name |
| PAI_LLM_BASE_URL | http://127.0.0.1:11434 | Provider URL |
| PAI_LLM_API_KEY | | API key (openai) |
| PAI_PLUGINS | memory,tasks | Active plugins |
