import type { ChatHistoryMessage, ReportExecution } from "@/types";

type ProgramFamily = "general" | "work" | "travel" | "buying";

export interface ProgramDraft {
  title: string;
  question: string;
  family: ProgramFamily;
  executionMode: ReportExecution;
  intervalHours: number;
  threadId?: string;
}

interface ThreadProgramDraftInput {
  threadId: string;
  threadTitle?: string | null;
  history: ChatHistoryMessage[];
}

interface InboxProgramDraftInput {
  type: "daily" | "research";
  title?: string;
  goal?: string;
  recommendationSummary?: string;
  rationale?: string;
  executionMode?: ReportExecution;
}

function compactText(value?: string | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trimEnd()}...`;
}

function isMeaningfulThreadTitle(value?: string | null): boolean {
  const normalized = compactText(value).toLowerCase();
  return Boolean(normalized) && !["chat", "new thread", "new conversation", "briefing discussion"].includes(normalized);
}

function keepWatchingQuestion(source: string, prefix: string): string {
  const normalized = compactText(source);
  if (!normalized) return prefix;
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("keep watching") || lowered.startsWith("monitor ") || lowered.startsWith("watch ")) {
    return truncate(normalized, 4000);
  }
  return truncate(`${prefix}: ${normalized}`, 4000);
}

export function buildThreadProgramDraft(input: ThreadProgramDraftInput): ProgramDraft {
  const userMessages = input.history
    .filter((message) => message.role === "user")
    .map((message) => compactText(message.content))
    .filter(Boolean);

  const meaningfulTitle = isMeaningfulThreadTitle(input.threadTitle) ? compactText(input.threadTitle) : "";
  const latestUserMessage = userMessages[userMessages.length - 1] ?? "";
  const longestUserMessage = [...userMessages].sort((left, right) => right.length - left.length)[0] ?? "";

  const titleSource = meaningfulTitle || longestUserMessage || latestUserMessage || "New watch";
  const questionSource = longestUserMessage || latestUserMessage || meaningfulTitle || titleSource;

  return {
    title: truncate(titleSource, 200),
    question: keepWatchingQuestion(questionSource, "Keep watching this conversation and brief me on meaningful changes"),
    family: "general",
    executionMode: "research",
    intervalHours: 24,
    threadId: input.threadId,
  };
}

export function buildInboxProgramDraft(input: InboxProgramDraftInput): ProgramDraft {
  if (input.type === "research") {
    const goal = compactText(input.goal) || compactText(input.title) || "Research topic";
    return {
      title: truncate(goal, 200),
      question: keepWatchingQuestion(goal, "Keep watching this topic and brief me on meaningful changes"),
      family: "general",
      executionMode: input.executionMode ?? "research",
      intervalHours: 24,
    };
  }

  const title = compactText(input.title) || compactText(input.recommendationSummary) || "Daily brief follow-through";
  const summary = compactText(input.recommendationSummary) || title;
  const rationale = compactText(input.rationale);
  const questionBase = keepWatchingQuestion(
    summary,
    "Keep watching this area and tell me if the recommendation should change",
  );

  return {
    title: truncate(title, 200),
    question: rationale ? truncate(`${questionBase} Current rationale: ${rationale}`, 4000) : questionBase,
    family: "general",
    executionMode: "research",
    intervalHours: 24,
  };
}
