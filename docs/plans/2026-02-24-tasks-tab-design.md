# Tasks Tab Design

**Date:** 2026-02-24
**Linear:** PAI-8 — Dedicated "To-Do" Tasks Tab with Completion Tracking

## Overview

Add a dedicated Tasks page to the web UI with two tabs: Tasks and Goals. The backend (`plugin-tasks`) already supports full CRUD. This feature adds REST endpoints and a UI page.

## Navigation

- New "Tasks" tab in sidebar between Knowledge and Timeline
- `CheckSquareIcon` from lucide-react
- Route: `/tasks`

## Tasks Tab

- **Header**: "Tasks" title + count badge + "Add Task" button
- **Filters**: Tab bar for status (Open | Done | All), optional goal filter dropdown
- **Task list** (responsive, single-column — tasks are text-heavy):
  - Title (strikethrough if done)
  - Priority badge (color-coded: red=high, yellow=medium, gray=low)
  - Due date (red if overdue)
  - Goal badge (if linked)
  - Actions: checkbox to complete/reopen, edit button, delete button
- **Add/Edit dialog**: Title (required), description (optional textarea), priority (select), due date (date input), goal (select from active goals)
- **Empty state**: Guidance text + add button

## Goals Tab

- **Header**: "Goals" title + count badge + "Add Goal" button
- **Goal cards** in a list:
  - Title
  - Task count badge (e.g., "3/5 done")
  - Progress bar
  - Actions: mark done, delete
- **Add dialog**: Title (required), description (optional)
- **Empty state**: Guidance text

## API Endpoints

```
GET    /api/tasks            — list (query: status, goalId)
POST   /api/tasks            — create (body: title, description?, priority?, dueDate?, goalId?)
PATCH  /api/tasks/:id        — update (body: title?, priority?, dueDate?, goalId?)
POST   /api/tasks/:id/done   — complete
POST   /api/tasks/:id/reopen — reopen
DELETE /api/tasks/:id        — delete
GET    /api/goals            — list
POST   /api/goals            — create (body: title, description?)
POST   /api/goals/:id/done   — complete
DELETE /api/goals/:id        — delete
```

## Backend Functions (existing)

From `plugin-tasks`: addTask, listTasks, editTask, completeTask, reopenTask, addGoal, listGoals, completeGoal. Need to add: deleteTask, deleteGoal.

## Data Fetching

useState + useCallback + refetch pattern (same as Memory/Knowledge pages). Toast notifications for feedback.

## Files to Create/Modify

- **Create**: `packages/server/src/routes/tasks.ts` — REST endpoints
- **Create**: `packages/ui/src/pages/Tasks.tsx` — Tasks page component
- **Modify**: `packages/server/src/index.ts` — register task routes
- **Modify**: `packages/ui/src/App.tsx` — add `/tasks` route
- **Modify**: `packages/ui/src/components/Layout.tsx` — add nav item
- **Modify**: `packages/ui/src/api.ts` — add task/goal API functions
- **Modify**: `packages/plugin-tasks/src/tasks.ts` — add deleteTask, deleteGoal
