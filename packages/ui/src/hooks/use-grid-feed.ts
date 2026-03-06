import { useMemo, useState } from "react";
import { useThreads } from "./use-threads";
import { useJobs } from "./use-jobs";
import { useInboxAll } from "./use-inbox";
import { useBeliefs } from "./use-beliefs";
import { useTasks } from "./use-tasks";
import { useKnowledgeSources } from "./use-knowledge";

export type GridCardType = "chat" | "research" | "briefing" | "memory" | "task" | "knowledge";

export interface GridCard {
  id: string;
  type: GridCardType;
  title: string;
  subtitle?: string;
  preview: string;
  tags?: string[];
  timestamp: string;
  navigateTo: string;
  automated?: boolean;
}

const GRID_CARD_TYPES: GridCardType[] = ["chat", "research", "briefing", "memory", "task", "knowledge"];

/** Normalize timestamps — some DB fields use "YYYY-MM-DD HH:MM:SS" (local, no TZ) */
function normalizeTs(ts: string): string {
  if (!ts) return ts;
  // If it already has T or Z, it's ISO — leave it
  if (ts.includes("T")) return ts;
  // "2026-03-06 08:43:05" → treat as UTC
  return ts.replace(" ", "T") + "Z";
}

function stripMarkdown(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")          // strip URLs
    .replace(/\[?\^?\d+\]?\(https?[^)]*\)/g, "") // strip citation links
    .replace(/[#*_`~>|\\]/g, "")             // strip markdown chars
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // [text](url) → text
    .replace(/\n{2,}/g, "\n")                 // collapse blank lines
    .replace(/\n/g, " ")                      // newlines to spaces
    .replace(/\s{2,}/g, " ")                  // collapse whitespace
    .trim();
}

export function useGridFeed() {
  const [filters, setFilters] = useState<Set<GridCardType>>(new Set());

  const threads = useThreads();
  const jobs = useJobs();
  const inbox = useInboxAll();
  const beliefs = useBeliefs();
  const tasks = useTasks();
  const knowledge = useKnowledgeSources();

  const isLoading = threads.isLoading || jobs.isLoading || inbox.isLoading ||
    beliefs.isLoading || tasks.isLoading || knowledge.isLoading;

  const cards = useMemo(() => {
    const result: GridCard[] = [];

    // Threads → chat cards
    for (const t of threads.data ?? []) {
      result.push({
        id: `chat-${t.id}`,
        type: "chat",
        title: t.title || "Untitled chat",
        subtitle: `${t.messageCount} messages`,
        preview: t.lastMessage ? stripMarkdown(t.lastMessage) : "",
        timestamp: normalizeTs(t.updatedAt || t.createdAt),
        navigateTo: `/chat?thread=${t.id}`,
      });
    }

    // Jobs (research/swarm, done) → research cards
    for (const j of (jobs.data?.jobs ?? []).filter(j => (j.type === "research" || j.type === "swarm") && j.status === "done")) {
      const report = j.result ? stripMarkdown(j.result) : "";
      result.push({
        id: `research-${j.id}`,
        type: "research",
        title: j.label || "Research",
        subtitle: j.resultType ? j.resultType.replace(/_/g, " ") : undefined,
        preview: report.slice(0, 800),
        tags: j.resultType ? [j.resultType] : undefined,
        timestamp: normalizeTs(j.completedAt || j.startedAt),
        navigateTo: `/jobs?id=${j.id}`,
        automated: j.sourceKind === "schedule",
      });
    }

    // Inbox → briefing cards
    for (const b of inbox.data?.briefings ?? []) {
      const sections = b.sections as Record<string, unknown>;
      const report = typeof sections?.report === "string" ? stripMarkdown(sections.report) : "";
      const greeting = typeof sections?.greeting === "string" ? sections.greeting : "";
      result.push({
        id: `briefing-${b.id}`,
        type: "briefing",
        title: b.type === "research" ? "Research Report" : "Daily Briefing",
        preview: (report || greeting).slice(0, 800),
        timestamp: normalizeTs(b.generatedAt),
        navigateTo: `/inbox/${b.id}`,
        automated: true,
      });
    }

    // Beliefs → memory cards
    for (const b of beliefs.data ?? []) {
      result.push({
        id: `memory-${b.id}`,
        type: "memory",
        title: b.type.charAt(0).toUpperCase() + b.type.slice(1),
        subtitle: b.subject !== "owner" ? `About ${b.subject}` : undefined,
        preview: b.statement,
        tags: [b.type],
        timestamp: normalizeTs(b.created_at),
        navigateTo: "/memory",
      });
    }

    // Tasks → task cards
    for (const t of tasks.data ?? []) {
      result.push({
        id: `task-${t.id}`,
        type: "task",
        title: t.title,
        subtitle: `${t.priority} priority`,
        preview: t.description || "",
        tags: [t.status],
        timestamp: normalizeTs(t.created_at),
        navigateTo: "/tasks",
      });
    }

    // Knowledge sources → knowledge cards
    for (const s of knowledge.data ?? []) {
      result.push({
        id: `knowledge-${s.id}`,
        type: "knowledge",
        title: s.title || s.url,
        subtitle: `${s.chunks} chunks`,
        preview: s.url || "",
        timestamp: normalizeTs(s.learnedAt),
        navigateTo: "/knowledge",
      });
    }

    // Sort newest first
    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return result;
  }, [threads.data, jobs.data, inbox.data, beliefs.data, tasks.data, knowledge.data]);

  const filteredCards = useMemo(() => {
    if (filters.size === 0) return cards;
    return cards.filter(c => filters.has(c.type));
  }, [cards, filters]);

  return { cards: filteredCards, allCards: cards, isLoading, filters, setFilters, cardTypes: GRID_CARD_TYPES };
}
