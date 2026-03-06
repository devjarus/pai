# Grid View — Spec

## Concept

A sidebar page ("Grid") showing all app activity as cards in a masonry layout. Inspired by Nova (lightmode.io) — a spatial, scrollable feed of everything in pai. Cards auto-populate from existing data and new items appear automatically.

## Layout Requirements (HARD)

1. Cards ordered **LEFT-TO-RIGHT, TOP-TO-DOWN** (reading order) — newest top-left, oldest bottom-right
2. **NO GAPS** between cards — cards pack tightly like bricks
3. **Variable card heights** — content drives height, not a fixed row height
4. **Responsive columns** — 2 on mobile, 3 on tablet, 4 on desktop
5. **Drag to rearrange** with dnd-kit, order persisted to localStorage

These constraints cannot be achieved with pure CSS. Uses `react-responsive-masonry` with `sequential` prop (shortest-column placement algorithm).

## Data Sources

| Type | API | Timestamp field | Card content |
|------|-----|----------------|-------------|
| Chat threads | `GET /api/threads` | `updated_at` (ISO) | Title + last assistant message (1000 chars via SQL subquery) |
| Research reports | `GET /api/jobs` (done) | `completed_at` (ISO) | Goal + report excerpt (1000 chars) + result type tag |
| Daily briefings | `GET /api/inbox/all` | `generated_at` (ISO) | Type label + report/greeting (800 chars) |
| Memories | `GET /api/beliefs` | `created_at` (no TZ!) | Type + subject + statement + type tag |
| Tasks | `GET /api/tasks` | `created_at` (no TZ!) | Title + priority + description + status tag |
| Knowledge | `GET /api/knowledge/sources` | `learnedAt` (ISO) | Title/URL + chunk count |

**Timestamp normalization**: Beliefs and tasks store `YYYY-MM-DD HH:MM:SS` (no timezone). All other sources use ISO with `Z`. `normalizeTs()` in `use-grid-feed.ts` converts all to ISO UTC for correct sorting.

## Sort Modes

### Chronological (toggle button active)
- All cards from all sources merged and sorted by timestamp, newest first
- Unseen automated cards (scheduled jobs, briefings) bubble to top
- Reading order: left-to-right, top-to-down

### Custom (default)
- Pinned cards first
- Then cards in user's drag-reordered sequence (localStorage)
- New cards prepended at top

## Filter Bar

Horizontal pill toggles at top of page:
`All` | `Chats` | `Research` | `Briefings` | `Memories` | `Tasks` | `Knowledge`

- Multiple filters active simultaneously (OR logic)
- "All" = no filter (everything shown)
- Sort-by-newest toggle icon (right of pills, tooltip on hover)
- `+` button (right side) — dropdown to create new items

## + Button Actions

| Option | Navigation | Auto-opens |
|--------|-----------|-----------|
| New Chat | `/chat` | New chat view |
| Add Memory | `/memory` | Inline input (no dialog) |
| Learn Knowledge | `/knowledge?action=learn` | Learn URL dialog |
| Add Task | `/tasks?action=add` | Add Task dialog |
| New Schedule | `/schedules?action=add` | New Schedule dialog |

Pages read `?action=` query param to auto-open their dialog on mount, then clear the param.

## Card Design

- **Rounded-xl** corners, **3px colored left border** per type
- **Type-tinted background**: subtle color wash (e.g. `bg-blue-500/[0.03]` for chat)
- **Type badge**: uppercase, colored icon + label (blue/violet/amber/emerald/rose/cyan)
- **Title**: 13px semibold, 2-line clamp
- **Subtitle**: muted (message count, priority, chunk count)
- **Divider** between header and preview content
- **Preview**: variable length, content drives card height, gradient fade at bottom
- **Tags**: bottom section with type/status badges
- **Timestamp**: relative ("2h ago", "3d ago") in top-right
- **Unseen indicator**: corner triangle on automated cards not yet clicked
- **Pin button**: appears on hover, persists to localStorage
- **Click**: navigates to detail page (`/chat?thread=ID`, `/jobs?id=ID`, etc.)
- **Hover**: subtle lift (-0.5 translate-y) + border brightens + shadow

## Card Content by Type

| Type | Width | Height | Content shown |
|------|-------|--------|-------------|
| Research | standard | tall | Goal title, result type subtitle, 800 char report excerpt, result type tag |
| Briefing | standard | tall | Report type, 800 char report/greeting |
| Chat | standard | medium-tall | Thread title, message count, last assistant message (up to 1000 chars) |
| Memory | standard | short | Belief type, subject, statement text, type tag |
| Task | standard | short | Title, priority, description, status tag |
| Knowledge | standard | short | Source title/URL, chunk count |

## Technical Implementation

### Dependencies
- `react-responsive-masonry` — masonry layout with sequential (L-R) ordering
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` — drag to rearrange
- `prop-types` — peer dep of react-responsive-masonry

### Files

| File | Purpose |
|------|---------|
| `pages/Grid.tsx` | Main page — filter bar, sort toggle, + button, masonry container |
| `components/GridCard.tsx` | Card component — type styling, preview, pin, unseen, click nav |
| `hooks/use-grid-feed.ts` | Unified feed — aggregates 6 hooks, normalizes timestamps, sorts, filters |
| `types/react-responsive-masonry.d.ts` | Type declarations for masonry library |
| `components/Layout.tsx` | Grid added to sidebar nav |
| `components/MobileTabBar.tsx` | Grid added to mobile nav |
| `App.tsx` | `/grid` route |

### Backend Changes
- `packages/core/src/threads.ts` — `listThreads()` SQL now includes `last_message` subquery (last assistant message, 1000 chars)
- `packages/server/src/routes/agents.ts` — `mapThread()` exposes `lastMessage`
- `packages/server/src/routes/jobs.ts` — research/swarm result preview increased from 300 to 1000 chars
- `packages/ui/src/types.ts` — `Thread.lastMessage` added

### localStorage Keys
- `pai-grid-order` — card ID array (drag order)
- `pai-grid-pins` — pinned card ID array
- `pai-grid-seen` — seen card ID array (for unseen indicator)

## Phase 2 (Future)
- Manual note cards (user-created freeform text)
- Multiple grids with named contexts
- Card resize (drag corners)
