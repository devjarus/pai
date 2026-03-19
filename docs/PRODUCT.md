# Design Context

## Users
pai serves its owner as a daily personal AI — checked regularly for digests, watches, and accumulated knowledge. It doubles as a deep research station for background monitoring and knowledge compounding. Family and friends interact via Telegram as secondary users. The owner is technical but the UI should not require technical knowledge to use.

## Brand Personality
**Warm, personal, trustworthy.** pai feels like a thoughtful assistant that genuinely knows you — not a tool you operate, but a system that works on your behalf. It should feel like opening a well-kept journal that has been quietly thinking for you.

## Aesthetic Direction
- **References:** Notion (modern, opinionated, design-forward), Arc Browser (confident typography, spatial organization)
- **Anti-references:** Dense enterprise UIs (no cramped data tables or tiny fonts), skeuomorphic design (no heavy shadows, gradients, or faux-3D)
- **Theme:** Dark-mode-first. oklch color space with warm hue-60 neutrals. Instrument Serif for brand display, DM Sans for body, Berkeley Mono for data.
- **Existing system:** Tailwind 4 + shadcn/ui + Radix primitives. CVA variants. Belief-type accent colors (blue/purple/emerald/orange/amber/pink). 5-color chart palette. PWA with standalone display.

## Design Principles

1. **Content-first.** Every element earns its space. No decorative chrome, no empty states that waste screen. The digest, the watch, the memory — that's what matters.

2. **Warm over clinical.** Rounded corners, warm neutrals, gentle transitions. The UI should feel personal, not like a dashboard. Use serif display type for moments of personality.

3. **Progressive density.** Home is spacious and scannable. Detail views can be dense. Let the user drill in — don't front-load complexity. Watches summary is calm; findings detail is rich.

4. **Quiet confidence.** Animations are subtle (fade-in, slight lift on hover). No bouncing, no confetti, no attention-grabbing motion. The system is always working — it doesn't need to prove it.

5. **Accessible by default.** Respect `prefers-reduced-motion`. Maintain contrast ratios. Touch targets for mobile. The Telegram integration means multi-device — design for all of them.
