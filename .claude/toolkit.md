# Toolkit Reference

What worked well building the pai platform UI and agent features.

## Skills Used

### `frontend-design:frontend-design`
The most impactful skill. Enforces distinctive, non-generic UI design:
- Forces bold aesthetic choices (typography, color, layout)
- Prevents "AI slop" — no Inter font, no purple-on-white gradients
- Pushes for motion, texture, spatial composition
- Result: dark theme with monospace accents, subtle borders, layered card depth

**When to invoke:** Any time you're building UI components or pages.

### `superpowers:dispatching-parallel-agents`
Used to parallelize independent work — e.g., building web search backend while redesigning UI simultaneously.

### `superpowers:verification-before-completion`
Run before claiming anything is done. Forces `pnpm test` / `pnpm build` before moving on.

## MCP Servers

### `shadcn` (MCP)
Component library integration. Key tools:
- `search_items_in_registries` — find components by name (button, dialog, tooltip)
- `view_items_in_registries` — see component API and file contents
- `get_item_examples_from_registries` — usage examples with full code
- `get_add_command_for_items` — get the `npx shadcn@latest add` command

**Usage pattern:**
```
1. search_items_in_registries(["@shadcn"], "tooltip")
2. view_items_in_registries(["@shadcn/tooltip"])
3. get_add_command_for_items(["@shadcn/tooltip"])
4. Run the add command via Bash
5. Import and use in your component
```

Components installed: `button`, `badge`, `card`, `dialog`, `tabs`, `scroll-area`, `skeleton`, `separator`, `tooltip`, `input`.

### `context7` (MCP)
Up-to-date docs for any library. Two-step process:
1. `resolve-library-id` — find the library ID (e.g., `/vercel/next.js`)
2. `query-docs` — ask specific questions against current docs

Used for: React, Tailwind CSS, Vite, react-markdown, remark-gfm.

### `chrome-devtools` (MCP)
Browser automation for visual testing:
- `take_snapshot` — a11y tree of the page (text-based, fast)
- `take_screenshot` — visual screenshot
- `navigate_page` — load URLs
- `click`, `fill` — interact with elements

**When to use:** After building UI, navigate to localhost and screenshot to verify layout.

### `deepwiki` (MCP)
AI docs for any GitHub repo:
- `ask_question("owner/repo", "how does X work?")` — answers with repo context
- `read_wiki_structure` — see available documentation topics

### `exa` (MCP)
Web search tools:
- `web_search_exa` — general web search with clean content
- `get_code_context_exa` — code-specific search (Stack Overflow, GitHub, docs)

## Subagents (Task tool)

### `frontend-developer`
Best for building React components. Has access to: Read, Write, MultiEdit, Bash, shadcn MCP, context7 MCP, playwright.

**When to use:** Delegate full page/component builds. Give it the design spec and let it work autonomously.

### `Explore`
Fast codebase search. Use with thoroughness levels: "quick", "medium", "very thorough".

**When to use:** Finding files, understanding patterns, answering "how does X work in this codebase?"

### `general-purpose`
Swiss army knife. Can search, read, write, fetch web content.

**When to use:** Research tasks, multi-step investigations, anything that doesn't fit a specialized agent.

### `Bash`
Command execution. Used for: git operations, `pnpm build`, `pnpm test`, starting servers, curl API endpoints.

## UI Stack That Worked

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | React + TypeScript | Type safety, ecosystem |
| Build | Vite | Fast HMR, simple config |
| Styling | Tailwind CSS | Utility-first, dark theme via CSS vars |
| Components | shadcn/ui | Unstyled primitives, copy-paste ownership |
| Markdown | react-markdown + remark-gfm | Chat message rendering |
| Icons | lucide-react | Consistent, tree-shakeable |
| Fonts | System mono + sans | Fast load, no FOUT |

## Key Patterns

### Dark theme with CSS variables
All colors defined as HSL in `globals.css`. Components use `bg-background`, `text-foreground`, `border-border` etc. Easy to change the entire palette from one file.

### Info bubbles for context
Custom `InfoBubble` component wrapping shadcn `Tooltip`. Used everywhere to explain metrics, types, and statuses without cluttering the UI.

### SSE streaming for chat
`POST /api/chat` returns Server-Sent Events. Client uses `ReadableStream` reader with `TextDecoder` to parse `data: {json}` lines. Yields `AsyncGenerator<SSEEvent>`.

### Server reinitialize pattern
When config changes (e.g., data directory), server calls `reinitialize()` which closes old SQLite, creates new storage/LLM at new path, runs migrations, and mutates `ctx` in place via `Object.assign` so all route handlers see updated state.

### Parallel agent dispatch
For independent tasks (e.g., "add web search" + "redesign Memory page"), launch multiple Task agents simultaneously. Each works in isolation, results merge cleanly.

## Workflow

```
1. Plan (EnterPlanMode or quick mental model)
2. Explore codebase (Explore agent or Glob/Grep)
3. Install components (shadcn MCP)
4. Build pages (frontend-developer agent or direct Edit)
5. Build + test (pnpm build && pnpm test)
6. Visual verify (chrome-devtools screenshot)
7. Iterate on feedback
```
