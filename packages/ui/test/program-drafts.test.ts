import { describe, expect, it } from "vitest";

import { buildInboxProgramDraft, buildThreadProgramDraft } from "../src/lib/program-drafts";

describe("program draft builders", () => {
  it("builds a thread-linked draft from a meaningful thread title", () => {
    const draft = buildThreadProgramDraft({
      threadId: "thread-123",
      threadTitle: "Atlas launch blockers",
      history: [
        { role: "user", content: "What changed this week?" },
        { role: "assistant", content: "Two blockers moved." },
      ],
    });

    expect(draft.title).toBe("Atlas launch blockers");
    expect(draft.threadId).toBe("thread-123");
    expect(draft.question).toContain("Keep watching this conversation");
    expect(draft.question).toContain("What changed this week?");
  });

  it("falls back to the strongest user message when the thread title is generic", () => {
    const draft = buildThreadProgramDraft({
      threadId: "thread-456",
      threadTitle: "New conversation",
      history: [
        { role: "user", content: "Track Japan flight prices for late May and tell me when the best option changes." },
        { role: "assistant", content: "I can do that." },
      ],
    });

    expect(draft.title).toContain("Track Japan flight prices");
    expect(draft.question).toContain("Track Japan flight prices");
  });

  it("builds a research inbox draft from the report goal", () => {
    const draft = buildInboxProgramDraft({
      type: "research",
      title: "Research report",
      goal: "Best clinics for a knee MRI near Portland",
      executionMode: "analysis",
    });

    expect(draft.title).toBe("Best clinics for a knee MRI near Portland");
    expect(draft.executionMode).toBe("analysis");
    expect(draft.question).toContain("Best clinics for a knee MRI near Portland");
  });

  it("builds a daily briefing draft from the recommendation and rationale", () => {
    const draft = buildInboxProgramDraft({
      type: "daily",
      title: "Thursday Briefing",
      recommendationSummary: "Delay the vendor switch until the rollback checklist is complete.",
      rationale: "Rollback ownership is still unclear.",
    });

    expect(draft.title).toBe("Thursday Briefing");
    expect(draft.question).toContain("Delay the vendor switch");
    expect(draft.question).toContain("Rollback ownership is still unclear");
  });
});
