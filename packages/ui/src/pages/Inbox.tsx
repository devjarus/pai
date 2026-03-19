import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { marked } from "marked";
import { recordProductEventApi } from "@/api";
import { stripMarkdown } from "@/lib/utils";
import type { Program } from "@/api";
import { useInboxAll, useInboxBriefing, useRefreshInbox, useClearInbox, useCreateThread, useRerunResearch, useConfig, useCreateProgram, useCorrectBelief, useCreateTask, usePrograms, useTasks, useRateDigest, useDigestSuggestions, useCorrectDigest } from "@/hooks";
import type { BriefingRawContextBelief, Task } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import MarkdownContent from "@/components/MarkdownContent";
import BriefProvenancePanel from "../components/BriefProvenancePanel";
import { ResultRenderer } from "@/components/results/ResultRenderer";
import { parseApiDate, timeAgo, formatInterval } from "@/lib/datetime";
import { findMatchingProgram } from "@/lib/program-dedupe";
import { buildInboxProgramDraft } from "@/lib/program-drafts";
import { specToStaticHtml } from "@/lib/render-to-html";
import {
  RefreshCwIcon,
  CheckCircle2Icon,
  BrainIcon,
  LightbulbIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  SparklesIcon,
  Trash2Icon,
  ClockIcon,
  CalendarClockIcon,
  SearchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderIcon,
  MessageSquarePlusIcon,
  FileTextIcon,
  FileJsonIcon,
  PrinterIcon,
  MessageCircleIcon,
  BookOpenIcon,
  ListTodoIcon,
  InboxIcon,
  StarIcon,
  PencilIcon,
  PlusCircleIcon,
} from "lucide-react";

const STORAGE_KEY = "pai-inbox-read";

const ORIGIN_BADGE: Record<string, { icon: string; label: string }> = {
  "user-said": { icon: "\uD83D\uDC64", label: "you said" },
  document: { icon: "\uD83D\uDCC4", label: "document" },
  web: { icon: "\uD83C\uDF10", label: "web" },
  inferred: { icon: "\uD83D\uDD2E", label: "inferred" },
  synthesized: { icon: "\uD83E\uDDE0", label: "synthesized" },
};


function saveBlob(content: string, type: string, filename: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportResearch(sections: { goal?: string; report?: string }, format: "md" | "txt" | "json"): void {
  const nameBase = (sections.goal ?? "research-report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "research-report";
  const report = stripRenderBlocks(sections.report ?? "");
  if (format === "json") {
    saveBlob(JSON.stringify({ goal: sections.goal ?? "Research Report", report }, null, 2), "application/json", `${nameBase}.json`);
    return;
  }
  if (format === "txt") {
    saveBlob(`Goal: ${sections.goal ?? "Research Report"}

${report}`, "text/plain;charset=utf-8", `${nameBase}.txt`);
    return;
  }
  saveBlob(`# ${sections.goal ?? "Research Report"}

${report}`, "text/markdown;charset=utf-8", `${nameBase}.md`);
}

/** Strip json/jsonrender fenced blocks (UI render specs, not for humans) */
function stripRenderBlocks(md: string): string {
  return md.replace(/```(?:json|jsonrender)\s*[\s\S]*?```/g, "").trim();
}

const REPORT_CSS = `
body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1a1a1a}
h1{font-size:1.6em;border-bottom:2px solid #2563eb;padding-bottom:8px;font-weight:700}
h2{font-size:1.3em;margin-top:1.5em;color:#2563eb;font-weight:600}
h3{font-size:1.1em;margin-top:1.2em;font-weight:600}
h4{font-size:1em;margin-top:1em;font-weight:600;color:#6b7280}
p{margin:0.75em 0}
ul,ol{padding-left:1.5em;margin:0.5em 0}li{margin:4px 0}
hr{border:none;border-top:1px solid #e5e5e5;margin:1.5em 0}
strong{font-weight:600}em{font-style:italic}
a{color:#2563eb;text-decoration:none}
table{width:100%;border-collapse:collapse;margin:1em 0;font-size:0.92em}
thead{background:#eff6ff}
th{font-weight:600;text-align:left;padding:0.5em 0.7em;border-bottom:2px solid #2563eb}
td{padding:0.4em 0.7em;border-bottom:1px solid #e5e7eb}
tr:nth-child(even){background:#f9fafb}
pre{background:#f3f4f6;padding:0.8em;border-radius:6px;overflow-x:auto;font-size:0.9em;margin:1em 0}
code{font-family:'SF Mono',Monaco,monospace;font-size:0.9em;background:#f3f4f6;padding:0.1em 0.3em;border-radius:3px}
pre code{background:none;padding:0}
blockquote{border-left:3px solid #2563eb;padding:0.5em 1em;margin:1em 0;background:#eff6ff;border-radius:0 6px 6px 0}
@media print{body{margin:0;padding:0}h2{break-after:avoid}tr{break-inside:avoid}table{font-size:10pt}}
`;

interface ReportVisual {
  artifactId: string;
  mimeType: string;
  kind: "chart" | "image";
  title: string;
  caption?: string;
  order: number;
}

function printResearchAsPdf(sections: {
  goal?: string;
  report?: string;
  renderSpec?: unknown;
  visuals?: ReportVisual[];
}): void {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  const title = (sections.goal ?? "Research Report").replace(/</g, "&lt;");

  let specHtml = "";
  let parsedSpec: Record<string, unknown> | null = null;
  if (sections.renderSpec) {
    parsedSpec = typeof sections.renderSpec === "string"
      ? (() => { try { return JSON.parse(sections.renderSpec); } catch { return null; } })()
      : sections.renderSpec as Record<string, unknown>;
    specHtml = specToStaticHtml(parsedSpec) ?? "";
  }

  // Render visuals not already referenced in the spec (same logic as ResultRenderer)
  let visualsHtml = "";
  if (sections.visuals && sections.visuals.length > 0) {
    const referencedIds = new Set<string>();
    if (parsedSpec && typeof parsedSpec === "object" && parsedSpec.elements) {
      for (const el of Object.values(parsedSpec.elements as Record<string, { props?: Record<string, unknown> }>)) {
        for (const candidate of [el.props?.src, el.props?.url]) {
          if (typeof candidate !== "string") continue;
          const match = candidate.match(/\/api\/artifacts\/([^/?#]+)/);
          if (match?.[1]) referencedIds.add(match[1]);
        }
      }
    }
    const remaining = sections.visuals
      .filter((v) => !referencedIds.has(v.artifactId))
      .sort((a, b) => a.order - b.order);
    if (remaining.length > 0) {
      visualsHtml = remaining.map((v) => {
        const caption = v.caption ? `<div style="font-size:0.8em;color:#6b7280;padding:6px 12px;border-top:1px solid #e5e7eb">${v.caption}</div>` : "";
        const src = `${window.location.origin}/api/artifacts/${v.artifactId}`;
        return `<div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:12px 0">
          <img src="${src}" alt="${v.title.replace(/"/g, '&quot;')}" style="width:100%;display:block"/>
          ${caption}
        </div>`;
      }).join("");
    }
  }

  const cleaned = stripRenderBlocks(sections.report ?? "");
  const markdownHtml = marked.parse(cleaned, { gfm: true, breaks: false, async: false }) as string;
  const body = specHtml + visualsHtml + markdownHtml;
  w.document.write(`<html><head><base href="${window.location.origin}/"><title>${title}</title><style>${REPORT_CSS}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function loadReadIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function persistReadIds(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

const ReadContext = createContext<{
  readIds: Set<string>;
  markRead: (id: string) => void;
}>({ readIds: new Set(), markRead: () => {} });

const priorityStyles: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/20",
  medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  low: "bg-muted text-muted-foreground border-border/40",
};

function beliefConfidenceLabel(value: number): "low" | "medium" | "high" {
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}


function formatRelativeFuture(iso: string | null | undefined): string {
  if (!iso) return "No schedule";
  const parsed = parseApiDate(iso);
  if (Number.isNaN(parsed.getTime())) return "Scheduled";
  const diff = parsed.getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `In ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `In ${hours}h`;
  return `In ${Math.round(hours / 24)}d`;
}

function briefingHeadline(item: InboxItem): string {
  if (item.type === "daily") return dailyBriefingTitle(item.sections);
  return (item.sections as { goal?: string }).goal ?? "Research report";
}

function actionPriorityForTiming(timing?: string): "low" | "medium" | "high" {
  const normalized = timing?.toLowerCase() ?? "";
  if (normalized.includes("now") || normalized.includes("today")) return "high";
  return "medium";
}

function normalizeTrackedTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildBriefActionDescription(briefTitle: string, action: { detail?: string; timing?: string }): string {
  return [
    action.detail?.trim(),
    action.timing ? `Timing: ${action.timing}` : null,
    `Saved from digest: ${briefTitle}`,
  ]
    .filter((item): item is string => !!item && item.length > 0)
    .join("\n\n");
}

interface InboxItem {
  id: string;
  generatedAt: string;
  sections: Record<string, unknown>;
  status: string;
  type: string;
}

interface DailyBriefingV2 {
  title?: string;
  recommendation?: {
    summary?: string;
    confidence?: "low" | "medium" | "high";
    rationale?: string;
  };
  what_changed?: string[];
  evidence?: Array<{
    title?: string;
    detail?: string;
    sourceLabel?: string;
    sourceUrl?: string;
    freshness?: string;
  }>;
  memory_assumptions?: Array<{
    statement?: string;
    confidence?: "low" | "medium" | "high";
    provenance?: string;
  }>;
  next_actions?: Array<{
    title?: string;
    timing?: string;
    detail?: string;
    owner?: string;
  }>;
  correction_hook?: {
    prompt?: string;
  };
}

interface DailyBriefingLegacy {
  greeting?: string;
  taskFocus?: { summary: string; items: Array<{ id: string; title: string; priority: string; insight: string }> };
  memoryInsights?: { summary: string; highlights: Array<{ statement: string; type: string; detail: string }> };
  suggestions?: Array<{ title: string; reason: string; action?: string }>;
}

function isDailyBriefingV2(raw: Record<string, unknown>): raw is Record<string, unknown> & DailyBriefingV2 {
  return typeof raw.recommendation === "object" && raw.recommendation !== null;
}

function dailyBriefingTitle(raw: Record<string, unknown>): string {
  if (isDailyBriefingV2(raw)) {
    return stripMarkdown(raw.title ?? raw.recommendation?.summary ?? "Daily Digest");
  }
  return stripMarkdown((raw as DailyBriefingLegacy).greeting ?? "Daily Digest");
}

export default function Inbox() {
  const { id } = useParams<{ id: string }>();
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);

  const markRead = useCallback((itemId: string) => {
    setReadIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      persistReadIds(next);
      return next;
    });
  }, []);

  if (id) {
    return (
      <ReadContext.Provider value={{ readIds, markRead }}>
        <InboxDetail id={id} />
      </ReadContext.Provider>
    );
  }
  return (
    <ReadContext.Provider value={{ readIds, markRead }}>
      <InboxFeed />
    </ReadContext.Provider>
  );
}

// ---- Detail View ----

function InboxDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [selectedBeliefSource, setSelectedBeliefSource] = useState<BriefingRawContextBelief | null>(null);
  const [correctionStatement, setCorrectionStatement] = useState("");
  const [correctedBeliefIds, setCorrectedBeliefIds] = useState<Set<string>>(() => new Set());
  const { markRead } = useContext(ReadContext);
  const { data: tasks = [] } = useTasks({ status: "all" });
  const { data: programs = [] } = usePrograms();
  const createThreadMut = useCreateThread();
  const createProgramMut = useCreateProgram();
  const createTaskMut = useCreateTask();
  const correctBeliefMutation = useCorrectBelief();
  const rerunMutation = useRerunResearch();
  const { data: configData } = useConfig();

  const { data: briefingData, isLoading: loading } = useInboxBriefing(id);

  const item: InboxItem | null = useMemo(() => {
    if (!briefingData) return null;
    const b = briefingData.briefing;
    return {
      id: b.id,
      generatedAt: b.generatedAt,
      sections: b.sections as unknown as Record<string, unknown>,
      status: b.status,
      type: (b as unknown as { type?: string }).type ?? "daily",
    };
  }, [briefingData]);

  const beliefSources = useMemo(() => {
    if (item?.type !== "daily") return [];
    const beliefs = briefingData?.briefing.rawContext?.beliefs;
    return Array.isArray(beliefs) ? beliefs : [];
  }, [briefingData, item?.type]);
  const briefLinkedActions = useMemo(
    () => tasks.filter((task) => task.source_type === "briefing" && task.source_id === id),
    [tasks, id],
  );
  const watchDraft = useMemo(() => {
    if (!item) return null;
    const detailSections = item.sections as {
      goal?: string;
      execution?: "research" | "analysis";
    };
    return item.type === "research"
      ? buildInboxProgramDraft({
          type: "research",
          title: detailSections.goal ?? "Research move",
          goal: detailSections.goal,
          executionMode: detailSections.execution ?? "research",
        })
      : buildInboxProgramDraft({
          type: "daily",
          title: dailyBriefingTitle(item.sections),
          recommendationSummary: isDailyBriefingV2(item.sections) ? item.sections.recommendation?.summary : undefined,
          rationale: isDailyBriefingV2(item.sections) ? item.sections.recommendation?.rationale : undefined,
        });
  }, [item]);
  const existingWatch = useMemo(
    () => (watchDraft
      ? findMatchingProgram(programs, {
          ...watchDraft,
          programId: briefingData?.briefing.programId ?? null,
          threadId: watchDraft.threadId ?? briefingData?.briefing.threadId ?? null,
        })
      : undefined),
    [briefingData?.briefing.programId, briefingData?.briefing.threadId, programs, watchDraft],
  );

  useEffect(() => {
    markRead(id);
  }, [id, markRead]);

  useEffect(() => {
    setCorrectedBeliefIds(new Set());
    setSelectedBeliefSource(null);
    setCorrectionStatement("");
  }, [id]);

  useEffect(() => {
    if (briefingData === undefined && !loading) {
      // query finished but no data (error case handled by react-query)
    }
  }, [briefingData, loading]);

  const openCorrectionDialog = (belief: BriefingRawContextBelief) => {
    setSelectedBeliefSource(belief);
    setCorrectionStatement(belief.statement);
  };

  const closeCorrectionDialog = () => {
    if (correctBeliefMutation.isPending) return;
    setSelectedBeliefSource(null);
    setCorrectionStatement("");
  };

  const handleSubmitCorrection = async () => {
    if (!selectedBeliefSource) return;
    const statement = correctionStatement.trim();
    if (!statement) {
      toast.error("Enter the corrected memory");
      return;
    }
    if (statement === selectedBeliefSource.statement.trim()) {
      toast.error("Update the statement before saving the correction");
      return;
    }
    try {
      await correctBeliefMutation.mutateAsync({
        id: selectedBeliefSource.id,
        statement,
        briefId: id,
        channel: "web",
      });
      setCorrectedBeliefIds((prev) => {
        const next = new Set(prev);
        next.add(selectedBeliefSource.id);
        return next;
      });
      toast.success("Correction saved. Future digests will use the replacement memory.");
      closeCorrectionDialog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save correction");
    }
  };

  const handleStartChat = async () => {
    if (!item) return;
    setCreating(true);
    try {
      const sections = item.sections as { goal?: string; report?: string };
      const rawTitle = item.type === "research"
        ? `Research: ${sections.goal ?? "Report"}`
        : dailyBriefingTitle(item.sections).slice(0, 60) || "Digest Discussion";
      const title = rawTitle.length > 200 ? rawTitle.slice(0, 197) + "..." : rawTitle;
      const thread = await createThreadMut.mutateAsync({ title });
      await recordProductEventApi({
        eventType: "brief_followup_asked",
        briefId: id,
        threadId: thread.id,
        channel: "web",
      });
      const context = item.type === "research"
        ? `I'd like to discuss this research report:\n\n**Goal:** ${sections.goal}\n\n${sections.report ?? ""}`
        : `I'd like to discuss today's digest.`;
      sessionStorage.setItem("pai-chat-auto-send", JSON.stringify({ threadId: thread.id, message: context }));
      navigate(`/ask?thread=${thread.id}`);
    } catch {
      toast.error("Failed to create chat thread");
    } finally {
      setCreating(false);
    }
  };

  const handleKeepWatching = async () => {
    if (!item || !watchDraft) return;
    if (existingWatch) {
      toast.message(
        existingWatch.threadId
          ? "That thread is already being watched."
          : `Already watching this as "${existingWatch.title}".`,
      );
      navigate("/programs");
      return;
    }
    try {
      const result = await createProgramMut.mutateAsync(watchDraft);
      if (result.created) {
        toast.success("Watch created. pai will keep watching this.");
        return;
      }
      toast.message(
        result.duplicateReason === "thread"
          ? "That thread is already being watched."
          : `Already watching this as "${result.program.title}".`,
      );
      navigate("/programs");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create watch");
    }
  };

  const handleCreateBriefAction = async (action: { title?: string; detail?: string; timing?: string }) => {
    const actionTitle = action.title?.trim();
    if (!item || item.type !== "daily" || !actionTitle) return;
    if (briefLinkedActions.some((task) => task.status === "open" && normalizeTrackedTitle(task.title) === normalizeTrackedTitle(actionTitle))) {
      toast.message("That move is already saved for this digest");
      return;
    }
    try {
      await createTaskMut.mutateAsync({
        title: actionTitle,
        description: buildBriefActionDescription(dailyBriefingTitle(item.sections), action),
        priority: actionPriorityForTiming(action.timing),
        sourceType: "briefing",
        sourceId: id,
        sourceLabel: dailyBriefingTitle(item.sections),
      });
      toast.success("To-do saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save to-do");
    }
  };

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4 md:p-6">
        <p className="text-sm text-muted-foreground">Digest not found</p>
        <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
          <ArrowLeftIcon className="h-4 w-4" /> Back to Digests
        </Button>
      </div>
    );
  }

  const sections = item.sections as {
    goal?: string;
    report?: string;
    execution?: "research" | "analysis";
    visuals?: Array<{
      artifactId: string;
      mimeType: string;
      kind: "chart" | "image";
      title: string;
      caption?: string;
      order: number;
    }>;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between md:mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="h-4 w-4" /> Digests
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {item?.type === "research" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportResearch(sections, "md")}
                  className="gap-2"
                >
                  <FileTextIcon className="h-3 w-3" />
                  .md
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportResearch(sections, "json")}
                  className="gap-2"
                >
                  <FileJsonIcon className="h-3 w-3" />
                  .json
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => printResearchAsPdf({
                    goal: sections.goal,
                    report: sections.report,
                    renderSpec: (sections as Record<string, unknown>).renderSpec,
                    visuals: sections.visuals,
                  })}
                  className="gap-2"
                >
                  <PrinterIcon className="h-3 w-3" />
                  PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    rerunMutation.mutate(id, {
                      onSuccess: () => toast.success("Research rerun queued"),
                      onError: () => toast.error("Failed to rerun research"),
                    });
                  }}
                  disabled={rerunMutation.isPending}
                  className="gap-2"
                >
                  <RefreshCwIcon className={`h-3 w-3 ${rerunMutation.isPending ? "animate-spin" : ""}`} />
                  Rerun
                </Button>
              </>
            )}
            <Button
              size="sm"
              onClick={existingWatch ? () => navigate("/programs") : handleKeepWatching}
              disabled={createProgramMut.isPending && !existingWatch}
              className="gap-2"
            >
              <CalendarClockIcon className="h-4 w-4" />
              {existingWatch ? "Open Watches" : createProgramMut.isPending ? "Creating..." : "Keep watching this"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartChat}
              disabled={creating}
              className="gap-2"
            >
              <MessageSquarePlusIcon className="h-4 w-4" />
              {creating ? "Creating..." : "Start Chat"}
            </Button>
          </div>
        </div>

        <div className="mb-4 md:mb-6">
          <div className="flex items-center gap-2 mb-2">
            {item.type === "research" ? (
              <Badge variant="outline" className="text-[10px] border-blue-500/20 bg-blue-500/10 text-blue-400">
                {sections.execution === "analysis" ? "Analysis Report" : "Research Report"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-primary/20 bg-primary/10 text-primary">Daily Digest</Badge>
            )}
            <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {item.type === "research" ? stripMarkdown(sections.goal ?? "Research Report") : dailyBriefingTitle(item.sections)}
          </h1>
        </div>

        <Separator className="mb-4 opacity-30 md:mb-6" />

        {item.type === "daily" ? (
          <DailyBriefingDetail
            sections={item.sections}
            briefId={item.id}
            briefTitle={dailyBriefingTitle(item.sections)}
            navigate={navigate}
            beliefSources={beliefSources}
            linkedActions={briefLinkedActions}
            correctedBeliefIds={correctedBeliefIds}
            onCorrectBelief={openCorrectionDialog}
            onCreateAction={handleCreateBriefAction}
          />
        ) : (
          <div className="rounded-lg border border-border/20 bg-card/40 p-4 md:p-6">
            <ResultRenderer
              spec={(sections as Record<string, unknown>).renderSpec}
              structuredResult={(sections as Record<string, unknown>).structuredResult}
              visuals={sections.visuals ?? []}
              markdown={sections.report}
              resultType={(sections as Record<string, unknown>).resultType as string | undefined}
              debug={configData?.debugResearch ?? false}
            />
          </div>
        )}

        <DigestSuggestionsSection digestId={id} briefTitle={item.type === "daily" ? dailyBriefingTitle(item.sections) : (sections.goal ?? "Digest")} />

        <DigestRatingWidget digestId={id} />

        <Dialog
          open={!!selectedBeliefSource}
          onOpenChange={(open) => {
            if (!open) closeCorrectionDialog();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Correct memory</DialogTitle>
              <DialogDescription>
                Replace the memory that influenced this digest. The next digest will use the new memory instead of the old one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border border-border/30 bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current memory</div>
                <p className="mt-1 text-sm text-foreground">{selectedBeliefSource?.statement}</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="belief-correction" className="text-sm font-medium text-foreground">
                  Replacement memory
                </label>
                <Textarea
                  id="belief-correction"
                  value={correctionStatement}
                  onChange={(event) => setCorrectionStatement(event.target.value)}
                  rows={4}
                  placeholder="Describe the corrected memory"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeCorrectionDialog} disabled={correctBeliefMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmitCorrection}
                disabled={
                  correctBeliefMutation.isPending ||
                  !selectedBeliefSource ||
                  correctionStatement.trim().length === 0 ||
                  correctionStatement.trim() === selectedBeliefSource.statement.trim()
                }
              >
                {correctBeliefMutation.isPending ? "Saving..." : "Save correction"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="h-12" />
      </div>
    </div>
  );
}

function DailyBriefingDetail({
  sections: raw,
  briefId,
  briefTitle,
  navigate,
  beliefSources,
  linkedActions,
  correctedBeliefIds,
  onCorrectBelief,
  onCreateAction,
}: {
  sections: Record<string, unknown>;
  briefId: string;
  briefTitle: string;
  navigate: ReturnType<typeof useNavigate>;
  beliefSources: BriefingRawContextBelief[];
  linkedActions: Task[];
  correctedBeliefIds: Set<string>;
  onCorrectBelief: (belief: BriefingRawContextBelief) => void;
  onCreateAction: (action: { title?: string; detail?: string; timing?: string }) => void;
}) {
  return isDailyBriefingV2(raw)
    ? (
      <DailyBriefingV2Detail
        sections={raw}
        briefId={briefId}
        briefTitle={briefTitle}
        navigate={navigate}
        beliefSources={beliefSources}
        linkedActions={linkedActions}
        correctedBeliefIds={correctedBeliefIds}
        onCorrectBelief={onCorrectBelief}
        onCreateAction={onCreateAction}
      />
    )
    : <DailyBriefingLegacyDetail sections={raw as DailyBriefingLegacy} navigate={navigate} />;
}

function DailyBriefingV2Detail({
  sections,
  briefId,
  briefTitle,
  navigate,
  beliefSources,
  linkedActions,
  correctedBeliefIds,
  onCorrectBelief,
  onCreateAction,
}: {
  sections: DailyBriefingV2;
  briefId: string;
  briefTitle: string;
  navigate: ReturnType<typeof useNavigate>;
  beliefSources: BriefingRawContextBelief[];
  linkedActions: Task[];
  correctedBeliefIds: Set<string>;
  onCorrectBelief: (belief: BriefingRawContextBelief) => void;
  onCreateAction: (action: { title?: string; detail?: string; timing?: string }) => void;
}) {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-semibold text-foreground">Recommendation</span>
          {sections.recommendation?.confidence && (
            <Badge variant="outline" className="text-[10px] uppercase">
              {sections.recommendation.confidence}
            </Badge>
          )}
        </div>
        <p className="mt-3 text-base font-medium text-foreground">
          {stripMarkdown(sections.recommendation?.summary ?? "No recommendation available")}
        </p>
        {sections.recommendation?.rationale && (
          <p className="mt-2 text-sm text-muted-foreground">{stripMarkdown(sections.recommendation.rationale)}</p>
        )}
      </div>

      <BriefProvenancePanel
        briefId={briefId}
        onScrollToBelief={(beliefId) => {
          const el = document.querySelector(`[data-belief-id="${beliefId}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      />

      {(sections.what_changed?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCwIcon className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-semibold text-foreground">What Changed</span>
          </div>
          <div className="space-y-2">
            {sections.what_changed!.map((item, index) => (
              <div key={index} className="rounded-md border border-border/20 bg-card/40 px-4 py-3 text-sm text-muted-foreground">
                {stripMarkdown(item)}
              </div>
            ))}
          </div>
        </div>
      )}

      {(sections.evidence?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BookOpenIcon className="h-4 w-4 text-blue-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Evidence</span>
          </div>
          <div className="space-y-3">
            {sections.evidence!.map((item, index) => (
              <div key={index} className="rounded-md border border-border/20 bg-card/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.title}</span>
                  {item.sourceLabel && (
                    <Badge variant="outline" className="text-[10px]">
                      {item.sourceLabel}
                    </Badge>
                  )}
                  {item.freshness && (
                    <span className="text-[11px] text-muted-foreground">{item.freshness}</span>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{item.detail}</p>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex text-xs text-primary hover:underline"
                  >
                    Open source
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(sections.memory_assumptions?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BrainIcon className="h-4 w-4 text-violet-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Memory Assumptions</span>
          </div>
          <div className="space-y-3">
            {sections.memory_assumptions!.map((item, index) => (
              <AssumptionCard key={index} assumption={item} briefId={briefId} />
            ))}
          </div>
        </div>
      )}

      {beliefSources.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BrainIcon className="h-4 w-4 text-emerald-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Memories Behind This Digest</span>
          </div>
          <div className="space-y-3">
            {beliefSources.map((belief) => {
              const corrected = correctedBeliefIds.has(belief.id);
              return (
                <div key={belief.id} data-belief-id={belief.id} className="rounded-md border border-border/20 bg-card/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{belief.statement}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {belief.type}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {beliefConfidenceLabel(belief.confidence)}
                    </Badge>
                    {belief.isNew && (
                      <Badge variant="outline" className="text-[10px] border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                        new
                      </Badge>
                    )}
                    {corrected && (
                      <Badge variant="outline" className="text-[10px] border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                        corrected
                      </Badge>
                    )}
                    {belief.origin && ORIGIN_BADGE[belief.origin] && (
                      <Badge variant="outline" className="text-[10px] border-sky-500/20 bg-sky-500/10 text-sky-300">
                        {ORIGIN_BADGE[belief.origin].icon} {ORIGIN_BADGE[belief.origin].label}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {belief.subject && belief.subject !== "owner" ? `About ${belief.subject} · ` : ""}
                    Updated {timeAgo(belief.updatedAt)} · Used {belief.accessCount} time{belief.accessCount === 1 ? "" : "s"}
                  </p>
                  {corrected && (
                    <p className="mt-2 text-xs text-emerald-300">
                      Saved as a replacement memory for future digests.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate("/memory")}>
                      View Memory
                    </Button>
                    <Button size="sm" onClick={() => onCorrectBelief(belief)}>
                      Correct Memory
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(sections.next_actions?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2Icon className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Recommended To-Dos</span>
          </div>
          <div className="space-y-3">
            {sections.next_actions!.map((action, index) => {
              const actionTitle = action.title?.trim();
              if (!actionTitle) return null;
              const alreadyTracked = linkedActions.some(
                (task) => task.status === "open" && normalizeTrackedTitle(task.title) === normalizeTrackedTitle(actionTitle),
              );
              return (
                <div key={index} className="rounded-md border border-border/20 bg-card/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{actionTitle}</span>
                    {action.timing && (
                      <Badge variant="outline" className="text-[10px]">
                        {action.timing}
                      </Badge>
                    )}
                    {action.owner && (
                      <span className="text-[11px] text-muted-foreground">Owner: {action.owner}</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{action.detail}</p>
                  <div className="mt-3">
                    {alreadyTracked ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate(
                            `/tasks?sourceType=briefing&sourceId=${encodeURIComponent(briefId)}&sourceLabel=${encodeURIComponent(briefTitle)}`,
                          )
                        }
                      >
                        Already Saved
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => onCreateAction(action)}>
                        Save To-Do
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {linkedActions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ListTodoIcon className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-sm font-semibold text-foreground">To-Dos From This Digest</span>
          </div>
          <div className="space-y-3">
            {linkedActions.map((task) => (
              <div key={task.id} className="rounded-md border border-border/20 bg-card/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{task.title}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {task.status}
                  </Badge>
                </div>
                {task.description && (
                  <p className="mt-2 text-xs text-muted-foreground whitespace-pre-line">{task.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sections.correction_hook?.prompt && (
        <div className="rounded-lg border border-border/20 bg-card/40 p-4">
          <div className="flex items-center gap-2">
            <MessageCircleIcon className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-semibold text-foreground">Correction Hook</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{sections.correction_hook.prompt}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/programs")}>
              Review Watches
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/ask")}>
              Open Ask
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Assumption correction card (inline in memory_assumptions) ----

function AssumptionCard({
  assumption,
  briefId,
}: {
  assumption: { statement?: string; confidence?: "low" | "medium" | "high"; provenance?: string };
  briefId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [correctedText, setCorrectedText] = useState(assumption.statement ?? "");
  const correctDigestMut = useCorrectDigest();

  const handleSubmitAssumptionCorrection = async () => {
    const text = correctedText.trim();
    if (!text || text === (assumption.statement ?? "").trim()) {
      toast.error("Update the statement before saving");
      return;
    }
    try {
      await correctDigestMut.mutateAsync({
        id: briefId,
        beliefId: "", // assumption-level correction, no specific belief ID
        correctedStatement: text,
        note: `Corrected assumption: "${assumption.statement}"`,
      });
      toast.success("Correction saved");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save correction");
    }
  };

  if (editing) {
    return (
      <div className="rounded-md border border-violet-500/30 bg-card/40 p-4 space-y-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Original assumption</div>
        <p className="text-sm text-muted-foreground">{assumption.statement}</p>
        <Textarea
          value={correctedText}
          onChange={(e) => setCorrectedText(e.target.value)}
          rows={3}
          placeholder="Enter the corrected statement"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSubmitAssumptionCorrection} disabled={correctDigestMut.isPending}>
            {correctDigestMut.isPending ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={correctDigestMut.isPending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/20 bg-card/40 p-4 transition-colors hover:border-violet-500/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{assumption.statement}</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {assumption.confidence ?? "medium"}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setCorrectedText(assumption.statement ?? "");
            setEditing(true);
          }}
          title="Correct this assumption"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{assumption.provenance}</p>
    </div>
  );
}

// ---- Digest rating widget ----

function DigestRatingWidget({ digestId }: { digestId: string }) {
  const [rating, setRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const rateDigestMut = useRateDigest();

  const handleSubmitRating = async () => {
    if (rating === 0) return;
    try {
      await rateDigestMut.mutateAsync({ id: digestId, rating, feedback: feedback.trim() || undefined });
      setSubmitted(true);
      toast.success("Thanks for rating this digest");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rating");
    }
  };

  if (submitted) {
    return (
      <div className="mt-6 rounded-lg border border-border/20 bg-card/40 p-4 text-center">
        <div className="flex items-center justify-center gap-1 mb-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <StarIcon key={s} className={`h-4 w-4 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Rating saved. Thank you!</p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-border/20 bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <StarIcon className="h-4 w-4 text-amber-400" />
        <span className="font-mono text-sm font-semibold text-foreground">Rate This Digest</span>
      </div>
      <div className="flex items-center gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setRating(s)}
            className="p-1 transition-colors hover:scale-110"
            title={`${s} star${s !== 1 ? "s" : ""}`}
          >
            <StarIcon className={`h-5 w-5 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-300"}`} />
          </button>
        ))}
        {rating > 0 && <span className="ml-2 text-xs text-muted-foreground">{rating}/5</span>}
      </div>
      {rating > 0 && (
        <>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="Optional feedback..."
            className="mb-3"
          />
          <Button size="sm" onClick={handleSubmitRating} disabled={rateDigestMut.isPending}>
            {rateDigestMut.isPending ? "Submitting..." : "Submit Rating"}
          </Button>
        </>
      )}
    </div>
  );
}

// ---- Digest suggestions section ----

function DigestSuggestionsSection({ digestId, briefTitle }: { digestId: string; briefTitle: string }) {
  const { data, isLoading } = useDigestSuggestions(digestId);
  const createTaskMut = useCreateTask();
  const [createdTitles, setCreatedTitles] = useState<Set<string>>(() => new Set());

  const suggestions = data?.suggestions ?? [];

  if (isLoading || suggestions.length === 0) return null;

  const handleCreateTodo = async (suggestion: { title: string; description?: string; priority?: string }) => {
    try {
      await createTaskMut.mutateAsync({
        title: suggestion.title,
        description: suggestion.description,
        priority: suggestion.priority ?? "medium",
        sourceType: "briefing",
        sourceId: digestId,
        sourceLabel: briefTitle,
      });
      setCreatedTitles((prev) => {
        const next = new Set(prev);
        next.add(suggestion.title);
        return next;
      });
      toast.success("To-do created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create to-do");
    }
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-2">
        <LightbulbIcon className="h-4 w-4 text-amber-400" />
        <span className="font-mono text-sm font-semibold text-foreground">Suggested To-Dos</span>
      </div>
      <div className="space-y-3">
        {suggestions.map((suggestion, index) => {
          const alreadyCreated = createdTitles.has(suggestion.title);
          return (
            <div key={index} className="rounded-md border border-border/20 bg-card/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{suggestion.title}</span>
                {suggestion.priority && (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {suggestion.priority}
                  </Badge>
                )}
              </div>
              {suggestion.description && (
                <p className="mt-2 text-xs text-muted-foreground">{suggestion.description}</p>
              )}
              <div className="mt-3">
                {alreadyCreated ? (
                  <Button variant="outline" size="sm" disabled>
                    <CheckCircle2Icon className="mr-1 h-3 w-3" /> Created
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => handleCreateTodo(suggestion)} disabled={createTaskMut.isPending}>
                    <PlusCircleIcon className="mr-1 h-3 w-3" /> Create To-Do
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailyBriefingLegacyDetail({ sections, navigate }: { sections: DailyBriefingLegacy; navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="space-y-4 md:space-y-6">
      {(sections.taskFocus?.items?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2Icon className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-semibold text-foreground">To-Do Focus</span>
          </div>
          <p className="text-sm text-muted-foreground">{sections.taskFocus!.summary}</p>
          {sections.taskFocus!.items.map((item, index) => (
            <div
              key={item.id || index}
              className="cursor-pointer rounded-md border border-border/20 bg-card/40 p-4 transition-colors hover:border-border/40"
              onClick={() => navigate("/tasks")}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                <Badge variant="outline" className={`text-[9px] ${priorityStyles[item.priority] ?? priorityStyles.low}`}>
                  {item.priority}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.insight}</p>
            </div>
          ))}
        </div>
      )}

      {(sections.memoryInsights?.highlights?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BrainIcon className="h-4 w-4 text-violet-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Memory Insights</span>
          </div>
          <p className="text-sm text-muted-foreground">{sections.memoryInsights!.summary}</p>
          {sections.memoryInsights!.highlights.map((item, index) => (
            <div
              key={index}
              className="cursor-pointer rounded-md border border-border/20 bg-card/40 p-4 transition-colors hover:border-violet-500/30"
              onClick={() => navigate("/memory")}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{item.statement}</span>
                <Badge variant="outline" className="text-[9px] border-violet-500/20 bg-violet-500/10 text-violet-400">
                  {item.type}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      )}

      {(sections.suggestions?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <LightbulbIcon className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Suggestions</span>
          </div>
          {sections.suggestions!.map((item, index) => (
            <div key={index} className="flex items-start justify-between gap-2 rounded-md border border-border/20 bg-card/40 p-4">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
              </div>
              {item.action && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                  onClick={() => {
                    if (item.action === "recall") navigate("/memory");
                    else if (item.action === "task") navigate("/tasks");
                    else if (item.action === "learn") navigate("/knowledge");
                  }}
                >
                  {item.action === "recall" ? "Recall" : item.action === "task" ? "To-Dos" : item.action === "learn" ? "Learn" : item.action}
                  <ArrowRightIcon className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Feed View ----

function InboxFeed() {
  const navigate = useNavigate();
  const prevGeneratingRef = useRef(false);
  const prevPendingRef = useRef(false);
  const { readIds, markRead } = useContext(ReadContext);
  const refreshInboxMut = useRefreshInbox();
  const clearInboxMut = useClearInbox();

  const { data: inboxData, isLoading: loading } = useInboxAll({
    refetchInterval: (data) => data?.generating || data?.pending ? 3000 : false,
  });
  const { data: programs = [], isLoading: programsLoading } = usePrograms();
  const { data: tasks = [], isLoading: tasksLoading } = useTasks({ status: "all" });
  const items: InboxItem[] = inboxData?.briefings ?? [];
  const generating = !!inboxData?.generating;
  const pending = !!inboxData?.pending;
  const busy = generating || pending || refreshInboxMut.isPending;

  // Track generating state transitions via query data
  useEffect(() => {
    if ((prevGeneratingRef.current || prevPendingRef.current) && !inboxData?.generating && !inboxData?.pending) {
      toast.success("Digest updated!");
    }
    prevGeneratingRef.current = !!inboxData?.generating;
    prevPendingRef.current = !!inboxData?.pending;
  }, [inboxData?.generating, inboxData?.pending]);

  // Store last seen briefing ID
  useEffect(() => {
    if (items.length > 0) {
      localStorage.setItem("pai-last-seen-briefing-id", items[0].id);
    }
  }, [items]);

  const unreadCount = useMemo(
    () => items.filter((i) => !readIds.has(i.id)).length,
    [items, readIds],
  );
  const activePrograms = useMemo(
    () => programs.filter((program) => program.status === "active"),
    [programs],
  );
  const pausedPrograms = useMemo(
    () => programs.filter((program) => program.status === "paused"),
    [programs],
  );
  const openActions = useMemo(
    () => tasks.filter((task) => task.status !== "done"),
    [tasks],
  );
  const recentlyCompletedActions = useMemo(
    () => tasks.filter((task) => task.completed_at && (Date.now() - parseApiDate(task.completed_at).getTime()) < (7 * 24 * 60 * 60 * 1000)),
    [tasks],
  );
  const actionsByProgramId = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.source_type !== "program" || !task.source_id) continue;
      const current = grouped.get(task.source_id) ?? [];
      current.push(task);
      grouped.set(task.source_id, current);
    }
    return grouped;
  }, [tasks]);
  const highlightedPrograms = useMemo(() => {
    return activePrograms
      .map((program) => {
        const linkedActions = actionsByProgramId.get(program.id) ?? [];
        const openLinkedActions = linkedActions.filter((task) => task.status !== "done");
        const completedLinkedActions = linkedActions.filter((task) => task.status === "done");
        const staleOpenCount = program.actionSummary?.staleOpenCount ?? openLinkedActions.filter((task) => {
          if (!task.due_date) return false;
          return parseApiDate(task.due_date).getTime() < Date.now();
        }).length;
        const openCount = program.actionSummary?.openCount ?? openLinkedActions.length;
        const completedCount = program.actionSummary?.completedCount ?? completedLinkedActions.length;
        const lastActivity = program.lastDeliveredAt
          ?? program.lastEvaluatedAt
          ?? program.lastRunAt
          ?? program.latestBriefSummary?.generatedAt
          ?? program.createdAt;
        const lastActivityAt = parseApiDate(lastActivity).getTime();
        return {
          program,
          openCount,
          completedCount,
          staleOpenCount,
          lastActivityAt: Number.isNaN(lastActivityAt) ? 0 : lastActivityAt,
        };
      })
      .sort((left, right) => {
        if (right.staleOpenCount !== left.staleOpenCount) return right.staleOpenCount - left.staleOpenCount;
        if (right.openCount !== left.openCount) return right.openCount - left.openCount;
        if (!!right.program.latestBriefSummary !== !!left.program.latestBriefSummary) {
          return Number(!!right.program.latestBriefSummary) - Number(!!left.program.latestBriefSummary);
        }
        return right.lastActivityAt - left.lastActivityAt;
      })
      .slice(0, 3);
  }, [activePrograms, actionsByProgramId]);
  const latestBrief = items[0] ?? null;
  const shouldShowWelcome = !busy && items.length === 0 && activePrograms.length === 0 && tasks.length === 0;
  const homeSummary = useMemo(() => {
    if (activePrograms.length === 0 && openActions.length === 0 && unreadCount === 0) {
      return "Start in Ask, then turn a question into a recurring watch.";
    }
    return [
      activePrograms.length > 0 ? `${activePrograms.length} active watch${activePrograms.length === 1 ? "" : "es"}` : null,
      openActions.length > 0 ? `${openActions.length} to-do${openActions.length === 1 ? "" : "s"} open` : null,
      unreadCount > 0 ? `${unreadCount} unread digest${unreadCount === 1 ? "" : "s"}` : null,
    ]
      .filter((part): part is string => !!part)
      .join(" • ");
  }, [activePrograms.length, openActions.length, unreadCount]);

  const handleCardClick = useCallback(
    (itemId: string) => {
      markRead(itemId);
      navigate(`/inbox/${itemId}`);
    },
    [markRead, navigate],
  );

  const handleRefresh = async () => {
    try {
      const result = await refreshInboxMut.mutateAsync();
      toast.success(result.message ?? "Digest queued");
    } catch {
      toast.error("Failed to start digest refresh");
    }
  };

  const handleClear = async () => {
    if (!confirm("Clear all digests? This cannot be undone.")) return;
    try {
      const result = await clearInboxMut.mutateAsync();
      toast.success(`Cleared ${result.cleared} item${result.cleared !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to clear digests");
    }
  };

  if (loading || programsLoading || tasksLoading) return <InboxSkeleton />;

  if (shouldShowWelcome) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-4 md:p-6">
        <div className="inbox-fade-in flex w-full max-w-md flex-col items-center gap-5 text-center">
          <SparklesIcon className="h-10 w-10 text-primary/60" />
          <div>
            <h2 className="font-mono text-lg font-semibold text-foreground">Welcome to pai</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start by chatting — I'll learn about you as we talk.
            </p>
          </div>
          <Button onClick={() => navigate("/ask")} className="gap-2">
            <MessageCircleIcon className="h-4 w-4" />
            Start asking
          </Button>
          <Separator className="w-full" />
          <div className="grid w-full gap-3 text-left">
            {[
              { icon: MessageCircleIcon, label: "Ask", desc: "Start with a question and turn it into a recurring watch" },
              { icon: BrainIcon, label: "Memories", desc: "What I know about you, always evolving" },
              { icon: BookOpenIcon, label: "Documents", desc: "Teach me web pages to reference later" },
              { icon: ListTodoIcon, label: "To-Dos", desc: "Manual moves pai should remember across future digests" },
              { icon: CalendarClockIcon, label: "Watches", desc: "Recurring decisions and watches pai keeps tracking" },
              { icon: InboxIcon, label: "Digests", desc: "Daily digests appear here as you use the app" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3 rounded-md border border-border/30 px-3 py-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-xs font-medium text-foreground">{label}</div>
                  <div className="text-[11px] text-muted-foreground">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <div className="inbox-fade-in flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-lg font-semibold text-foreground">Home</h1>
              <Badge variant="outline" className="text-[10px]">
                {items.length} digest{items.length === 1 ? "" : "s"}
              </Badge>
              {unreadCount > 0 && (
                <Badge className="text-[10px] bg-blue-500 text-white hover:bg-blue-600">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{homeSummary}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCwIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2Icon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {pending && !generating && (
          <div className="inbox-fade-in flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
            <ClockIcon className="h-4 w-4 text-yellow-400" />
            <span className="text-sm text-yellow-300">Digest queued. Waiting for background slot...</span>
          </div>
        )}

        {generating && (
          <div className="inbox-fade-in flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <LoaderIcon className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-primary">Generating new digest...</span>
          </div>
        )}

        <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card/70 to-card/60">
          <CardContent className="space-y-5 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <SparklesIcon className="h-4 w-4 text-primary" />
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">Core Loop</span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-foreground">What pai is actively watching</h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Watches keep watching in the background, digests explain what changed, and to-dos keep the one manual move you explicitly want pai to remember.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate("/ask")} className="gap-2">
                  <MessageCircleIcon className="h-4 w-4" />
                  Ask
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/programs")} className="gap-2">
                  <CalendarClockIcon className="h-4 w-4" />
                  Watches
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/tasks")} className="gap-2">
                  <ListTodoIcon className="h-4 w-4" />
                  To-Dos
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <LoopMetricCard
                icon={<CalendarClockIcon className="h-4 w-4 text-primary" />}
                label="Active Watches"
                value={activePrograms.length}
                detail={pausedPrograms.length > 0 ? `${pausedPrograms.length} paused` : "Recurring watches"}
                actionLabel="Open Watches"
                onClick={() => navigate("/programs")}
              />
              <LoopMetricCard
                icon={<ListTodoIcon className="h-4 w-4 text-amber-400" />}
                label="Open To-Dos"
                value={openActions.length}
                detail={recentlyCompletedActions.length > 0 ? `${recentlyCompletedActions.length} completed this week` : "To-dos still in flight"}
                actionLabel="Open To-Dos"
                onClick={() => navigate("/tasks")}
              />
              <LoopMetricCard
                icon={<InboxIcon className="h-4 w-4 text-blue-400" />}
                label="Latest Digest"
                value={latestBrief ? timeAgo(latestBrief.generatedAt) : "None"}
                detail={latestBrief ? briefingHeadline(latestBrief) : "Generate a digest after your first watch or refresh"}
                actionLabel={latestBrief ? "Open Digest" : "Refresh"}
                onClick={() => {
                  if (latestBrief) {
                    handleCardClick(latestBrief.id);
                    return;
                  }
                  void handleRefresh();
                }}
              />
            </div>

            {highlightedPrograms.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Watches in motion</h3>
                    <p className="text-xs text-muted-foreground">The watches with the clearest recent activity or to-dos.</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/programs")}>
                    View all
                  </Button>
                </div>
                <div className="grid gap-3 lg:grid-cols-3">
                  {highlightedPrograms.map(({ program, openCount, completedCount, staleOpenCount }) => (
                    <ProgramSpotlightCard
                      key={program.id}
                      program={program}
                      openCount={openCount}
                      completedCount={completedCount}
                      staleOpenCount={staleOpenCount}
                      onOpenProgram={() => navigate("/programs")}
                      onOpenBrief={() => {
                        if (program.latestBriefSummary?.id) {
                          handleCardClick(program.latestBriefSummary.id);
                          return;
                        }
                        navigate("/programs");
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-mono text-sm font-semibold text-foreground">Recent Digests</h2>
              <p className="text-xs text-muted-foreground">Archive and reopen the latest daily, research, and analysis outputs.</p>
            </div>
            {items.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {items.length} total
              </Badge>
            )}
          </div>
          <Separator className="opacity-30" />
        </div>

        {items.length === 0 ? (
          <Card className="border-dashed border-border/40 bg-card/30">
            <CardContent className="flex flex-col gap-3 p-6 text-sm text-muted-foreground">
              <p>No digests yet.</p>
              <p>Create a Watch in Ask or Watches, or trigger a refresh once pai has something meaningful to summarize.</p>
            </CardContent>
          </Card>
        ) : (
          items.map((item, idx) => (
            <div
              key={item.id}
              className={`inbox-fade-in ${readIds.has(item.id) ? "opacity-80" : ""}`}
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              {item.type === "daily" ? (
                <DailyBriefingCard item={item} onCardClick={handleCardClick} isRead={readIds.has(item.id)} />
              ) : item.type === "research" ? (
                <ResearchReportCard item={item} onCardClick={handleCardClick} isRead={readIds.has(item.id)} />
              ) : (
                <GenericBriefingCard item={item} />
              )}
            </div>
          ))
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}

function LoopMetricCard({
  icon,
  label,
  value,
  detail,
  actionLabel,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  detail: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/30 bg-background/60 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold text-foreground">{value}</div>
      <p className="mt-1 min-h-10 text-xs text-muted-foreground">{detail}</p>
      <Button variant="ghost" size="sm" onClick={onClick} className="mt-3 h-7 px-0 text-xs">
        {actionLabel}
        <ArrowRightIcon className="ml-1 h-3 w-3" />
      </Button>
    </div>
  );
}

function ProgramSpotlightCard({
  program,
  openCount,
  completedCount,
  staleOpenCount,
  onOpenProgram,
  onOpenBrief,
}: {
  program: Program;
  openCount: number;
  completedCount: number;
  staleOpenCount: number;
  onOpenProgram: () => void;
  onOpenBrief: () => void;
}) {
  const latestSummary = program.latestBriefSummary?.recommendationSummary?.trim();

  return (
    <div className="rounded-xl border border-border/30 bg-background/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] border-primary/20 bg-primary/10 text-primary">
          Watch
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {program.deliveryMode ?? "interval"}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {formatInterval(program.intervalHours)}
        </Badge>
      </div>
      <div className="mt-3">
        <div className="text-sm font-semibold text-foreground">{program.title}</div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {latestSummary || program.question}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>{formatRelativeFuture(program.nextRunAt)}</span>
        <span>•</span>
        <span>{openCount} to-do{openCount === 1 ? "" : "s"} open</span>
        {completedCount > 0 && (
          <>
            <span>•</span>
            <span>{completedCount} completed</span>
          </>
        )}
        {staleOpenCount > 0 && (
          <>
            <span>•</span>
            <span className="text-amber-300">{staleOpenCount} stale</span>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onOpenProgram}>
          Open Watch
        </Button>
        {program.latestBriefSummary?.id && (
          <Button size="sm" onClick={onOpenBrief}>
            Open Latest Digest
          </Button>
        )}
      </div>
    </div>
  );
}

function DailyBriefingCard({ item, onCardClick, isRead }: { item: InboxItem; onCardClick: (id: string) => void; isRead: boolean }) {
  return isDailyBriefingV2(item.sections)
    ? <DailyBriefingV2Card item={item} onCardClick={onCardClick} isRead={isRead} />
    : <DailyBriefingLegacyCard item={item} onCardClick={onCardClick} isRead={isRead} />;
}

function DailyBriefingV2Card({ item, onCardClick, isRead }: { item: InboxItem; onCardClick: (id: string) => void; isRead: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const sections = item.sections as DailyBriefingV2;
  const counts: string[] = [];
  if ((sections.what_changed?.length ?? 0) > 0) counts.push(`${sections.what_changed!.length} changes`);
  if ((sections.evidence?.length ?? 0) > 0) counts.push(`${sections.evidence!.length} evidence`);
  if ((sections.next_actions?.length ?? 0) > 0) counts.push(`${sections.next_actions!.length} moves`);

  return (
    <Card className="relative border-border/30 bg-card/40 transition-all duration-200">
      {!isRead && (
        <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-blue-500" />
      )}
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onCardClick(item.id)}>
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 shrink-0 text-primary" />
              <Badge variant="outline" className="text-[10px] border-primary/20 bg-primary/10 text-primary">
                Daily Digest
              </Badge>
              {sections.recommendation?.confidence && (
                <Badge variant="outline" className="text-[10px] uppercase">
                  {sections.recommendation.confidence}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground leading-relaxed">
              {dailyBriefingTitle(item.sections)}
            </p>
            {sections.recommendation?.rationale && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {stripMarkdown(sections.recommendation.rationale)}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </Button>
        </div>

        {!expanded && counts.length > 0 && (
          <div className="mt-2 text-[10px] text-muted-foreground">{counts.join(" \u00B7 ")}</div>
        )}

        {expanded && (
          <div className="mt-4 space-y-4">
            {(sections.what_changed?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <RefreshCwIcon className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono text-xs font-semibold text-foreground">What Changed</span>
                </div>
                {sections.what_changed!.slice(0, 2).map((change, index) => (
                  <div key={index} className="rounded-md border border-border/20 bg-background/40 p-3 text-[11px] text-muted-foreground">
                    {change}
                  </div>
                ))}
              </div>
            )}

            {(sections.memory_assumptions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <BrainIcon className="h-3.5 w-3.5 text-violet-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">Memory Assumptions</span>
                </div>
                {sections.memory_assumptions!.slice(0, 2).map((assumption, index) => (
                  <div
                    key={index}
                    className="cursor-pointer rounded-md border border-border/20 bg-background/40 p-3 transition-colors hover:border-violet-500/30"
                    onClick={() => navigate("/memory")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{assumption.statement}</span>
                      {assumption.confidence && (
                        <Badge variant="outline" className="text-[9px] uppercase">
                          {assumption.confidence}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{assumption.provenance}</p>
                  </div>
                ))}
              </div>
            )}

            {(sections.next_actions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-amber-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">Recommended To-Dos</span>
                </div>
                {sections.next_actions!.slice(0, 2).map((action, index) => (
                  <div key={index} className="rounded-md border border-border/20 bg-background/40 p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{action.title}</span>
                      {action.timing && (
                        <Badge variant="outline" className="text-[9px]">
                          {action.timing}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{action.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyBriefingLegacyCard({ item, onCardClick, isRead }: { item: InboxItem; onCardClick: (id: string) => void; isRead: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const sections = item.sections as DailyBriefingLegacy;

  const counts: string[] = [];
  if ((sections.taskFocus?.items?.length ?? 0) > 0) {
    const n = sections.taskFocus!.items.length;
    counts.push(`${n} move${n !== 1 ? "s" : ""}`);
  }
  if ((sections.memoryInsights?.highlights?.length ?? 0) > 0) {
    const n = sections.memoryInsights!.highlights.length;
    counts.push(`${n} insight${n !== 1 ? "s" : ""}`);
  }
  if ((sections.suggestions?.length ?? 0) > 0) {
    const n = sections.suggestions!.length;
    counts.push(`${n} suggestion${n !== 1 ? "s" : ""}`);
  }

  return (
    <Card className="relative border-border/30 bg-card/40 transition-all duration-200">
      {!isRead && (
        <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-blue-500" />
      )}
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => onCardClick(item.id)}
          >
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 shrink-0 text-primary" />
              <Badge variant="outline" className="text-[10px] border-primary/20 bg-primary/10 text-primary">
                Daily Digest
              </Badge>
              <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground leading-relaxed">
              {sections.greeting ?? "Daily digest"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </Button>
        </div>

        {!expanded && counts.length > 0 && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            {counts.join(" \u00B7 ")}
          </div>
        )}

        {expanded && (
          <div className="mt-4 space-y-4">
            {(sections.taskFocus?.items?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono text-xs font-semibold text-foreground">To-Do Focus</span>
                </div>
                <p className="text-xs text-muted-foreground">{sections.taskFocus!.summary}</p>
                {sections.taskFocus!.items.map((t, i) => (
                  <div
                    key={t.id || i}
                    className="cursor-pointer rounded-md border border-border/20 bg-background/40 p-3 transition-colors hover:border-border/40"
                    onClick={() => navigate("/tasks")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{t.title}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] ${priorityStyles[t.priority] ?? priorityStyles.low}`}
                      >
                        {t.priority}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t.insight}</p>
                  </div>
                ))}
              </div>
            )}

            {(sections.memoryInsights?.highlights?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <BrainIcon className="h-3.5 w-3.5 text-violet-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">Memory Insights</span>
                </div>
                <p className="text-xs text-muted-foreground">{sections.memoryInsights!.summary}</p>
                {sections.memoryInsights!.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="cursor-pointer rounded-md border border-border/20 bg-background/40 p-3 transition-colors hover:border-violet-500/30"
                    onClick={() => navigate("/memory")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{h.statement}</span>
                      <Badge variant="outline" className="text-[9px] border-violet-500/20 bg-violet-500/10 text-violet-400">
                        {h.type}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{h.detail}</p>
                  </div>
                ))}
              </div>
            )}

            {(sections.suggestions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <LightbulbIcon className="h-3.5 w-3.5 text-amber-400" />
                  <span className="font-mono text-xs font-semibold text-foreground">Suggestions</span>
                </div>
                {sections.suggestions!.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 rounded-md border border-border/20 bg-background/40 p-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-foreground">{s.title}</span>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{s.reason}</p>
                    </div>
                    {s.action && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-[10px] text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                        onClick={() => {
                          if (s.action === "recall") navigate("/memory");
                          else if (s.action === "task") navigate("/tasks");
                          else if (s.action === "learn") navigate("/knowledge");
                        }}
                      >
                        {s.action === "recall" ? "Recall" : s.action === "task" ? "To-Dos" : s.action === "learn" ? "Learn" : s.action}
                        <ArrowRightIcon className="ml-1 h-2.5 w-2.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Strip render blocks, json code fences, and markdown tables from report content for clean text display. */
function stripCodeFences(md: string): string {
  return md
    .replace(/```jsonrender\s*[\s\S]*?```/g, "")
    .replace(/```json\s*[\s\S]*?```/g, "")
    .replace(/```\w*\n[\s\S]*?```/g, "")
    .replace(/^\|.+\|\n\|[\s:|-]+\|\n(?:\|.+\|\n?)+/gm, "")
    .trim();
}

const domainBadges: Record<string, { icon: string; label: string; color: string; border: string; bg: string }> = {
  flight: { icon: "\u2708", label: "Flight", color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/10" },
  stock: { icon: "\uD83D\uDCCA", label: "Stock", color: "text-green-400", border: "border-green-500/20", bg: "bg-green-500/10" },
  crypto: { icon: "\uD83E\uDE99", label: "Crypto", color: "text-orange-400", border: "border-orange-500/20", bg: "bg-orange-500/10" },
  news: { icon: "\uD83D\uDCF0", label: "News", color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/10" },
  comparison: { icon: "\u2696\uFE0F", label: "Comparison", color: "text-cyan-400", border: "border-cyan-500/20", bg: "bg-cyan-500/10" },
};

function ResearchReportCard({ item, onCardClick, isRead }: { item: InboxItem; onCardClick: (id: string) => void; isRead: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const sections = item.sections as {
    report?: string;
    goal?: string;
    resultType?: string;
    execution?: "research" | "analysis";
    visuals?: Array<unknown>;
  };
  const domain = domainBadges[sections.resultType ?? ""];

  return (
    <Card className="relative border-border/30 bg-card/40 transition-all duration-200">
      {!isRead && (
        <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-blue-500" />
      )}
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => onCardClick(item.id)}
          >
            <div className="flex items-center gap-2">
              <SearchIcon className="h-4 w-4 shrink-0 text-blue-400" />
              <Badge variant="outline" className="text-[10px] border-blue-500/20 bg-blue-500/10 text-blue-400">
                {sections.execution === "analysis" ? "Analysis Report" : "Research Report"}
              </Badge>
              {domain && (
                <Badge variant="outline" className={`text-[10px] ${domain.border} ${domain.bg} ${domain.color}`}>
                  {domain.icon} {domain.label}
                </Badge>
              )}
              {(sections.visuals?.length ?? 0) > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {(sections.visuals?.length ?? 0)} visual{sections.visuals?.length === 1 ? "" : "s"}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {stripMarkdown(sections.goal ?? "Research report")}
            </p>
            {!expanded && sections.report && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {stripCodeFences(sections.report).slice(0, 200)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {expanded && sections.report && (
          <div className="mt-4 rounded-md border border-border/20 bg-background/40 p-4">
            <MarkdownContent content={stripCodeFences(sections.report)} />
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/inbox/${item.id}`)}
                className="gap-2 text-xs"
              >
                Open Full View
                <ArrowRightIcon className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GenericBriefingCard({ item }: { item: InboxItem }) {
  return (
    <Card className="border-border/30 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-muted-foreground" />
          <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
          <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {item.type === "daily"
            ? dailyBriefingTitle(item.sections)
            : (item.sections as { goal?: string }).goal ?? "No preview available"}
        </p>
      </CardContent>
    </Card>
  );
}

function InboxSkeleton() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-24" />
          <div className="flex gap-1">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
        <Separator className="opacity-30" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
