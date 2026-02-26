# Unread Indicators Design

## Goal

Add visual "unread dot" indicators for two areas: chat threads in the sidebar and the Inbox nav item — so the user knows when new activity has happened without actively checking.

## Features

### 1. Chat Thread Unread Dot

**Trigger:** SSE message arrives on a thread that is not currently active.

**State:** Client-side `Set<string>` of thread IDs with unread messages. No persistence — resets on page refresh.

**Mark unread:** When streaming response arrives and thread ID !== activeThreadId, add thread ID to unread set.

**Mark read:** When user clicks/switches to a thread, remove from unread set.

**Visual:** Small `w-2 h-2 rounded-full bg-primary` dot next to thread title in sidebar.

### 2. Inbox Nav Badge

**Trigger:** A new briefing exists that the user hasn't seen.

**State:** `lastSeenBriefingId` stored in `localStorage`. Compare against latest briefing ID.

**Mark unseen:** On app load, fetch latest briefing ID. If it differs from localStorage value, show dot on Inbox nav item.

**Mark seen:** When user visits Inbox page, update `lastSeenBriefingId` in localStorage.

**Visual:** Small `w-2 h-2 rounded-full bg-primary` dot positioned on the Inbox icon in the left nav.

**Polling:** Lightweight check every 5 minutes to `/api/inbox` from Layout component to detect new briefings while user is on other pages.

## Architecture

- **No backend changes.** Both features are purely client-side.
- Chat unread state lives in Chat.tsx component state.
- Inbox unread state lives in Layout.tsx with localStorage persistence.
- Both use the same dot visual pattern for consistency.

## Files to modify

- `packages/ui/src/pages/Chat.tsx` — unread set state, mark unread on SSE, mark read on switch, render dot
- `packages/ui/src/components/Layout.tsx` — inbox polling, localStorage check, render dot on Inbox nav item
- `packages/ui/src/pages/Inbox.tsx` — mark briefing as seen on mount
