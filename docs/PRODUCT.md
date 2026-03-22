# Design Context

## Users
pai serves its owner as a daily personal AI — checked regularly for digests, watches, and accumulated knowledge. It doubles as a deep research station for background monitoring and knowledge compounding. Family and friends interact via Telegram as secondary users. The owner is technical but the UI should not require technical knowledge to use.

**Core emotion after reading a digest: Clarity.** "I know exactly what matters today and what to do about it." Every screen should move the user closer to that feeling.

## Brand Personality
**Calm, precise, trustworthy.** pai is a senior analyst that speaks only when it has something worth saying. It should feel like opening a well-kept brief that has been quietly thinking for you — not a chat window waiting for your next message.

## Aesthetic Direction
- **References:** Notion (modern, opinionated, design-forward), Arc Browser (confident typography, spatial organization)
- **Anti-references:** Dense enterprise UIs (no cramped data tables or tiny fonts), skeuomorphic design (no heavy shadows, gradients, or faux-3D), **chat-first AI apps** (no ChatGPT-style single-thread conversation UI — pai is a digest/watch/research tool, not a chatbot)
- **Theme:** Dark-mode-first. oklch color space with warm hue-60 neutrals. Instrument Serif for brand display, DM Sans for body, Berkeley Mono for data.
- **Existing system:** Tailwind 4 + shadcn/ui + Radix primitives. CVA variants. Belief-type accent colors (blue/purple/emerald/orange/amber/pink). 5-color chart palette. PWA with standalone display.

## Design Principles

1. **Content-first.** Every element earns its space. No decorative chrome, no empty states that waste screen. The digest, the watch, the memory — that's what matters.

2. **Warm over clinical.** Rounded corners, warm neutrals, gentle transitions. The UI should feel personal, not like a dashboard. Use serif display type for moments of personality.

3. **Progressive density.** Home is spacious and scannable. Detail views can be dense. Let the user drill in — don't front-load complexity. Watches summary is calm; findings detail is rich.

4. **Quiet confidence.** Animations are subtle (fade-in, slight lift on hover). No bouncing, no confetti, no attention-grabbing motion. The system is always working — it doesn't need to prove it.

5. **Accessible by default.** WCAG AA compliance. Respect `prefers-reduced-motion`. Maintain contrast ratios (4.5:1 text, 3:1 UI). Touch targets for mobile. The Telegram integration means multi-device — design for all of them.
