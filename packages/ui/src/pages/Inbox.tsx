import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { marked } from "marked";
import { useInboxAll, useInboxBriefing, useRefreshInbox, useClearInbox, useCreateThread, useRerunResearch, useConfig, useCreateProgram, useCorrectBelief, useCreateTask, useTasks } from "@/hooks";
import type { BriefingRawContextBelief, Task } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import MarkdownContent from "@/components/MarkdownContent";
import { ResultRenderer } from "@/components/results/ResultRenderer";
import { parseApiDate } from "@/lib/datetime";
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
} from "lucide-react";

const STORAGE_KEY = "pai-inbox-read";


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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseApiDate(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function beliefConfidenceLabel(value: number): "low" | "medium" | "high" {
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}

function actionPriorityForTiming(timing?: string): "low" | "medium" | "high" {
  const normalized = timing?.toLowerCase() ?? "";
  if (normalized.includes("now") || normalized.includes("today")) return "high";
  return "medium";
}

function buildBriefActionDescription(briefTitle: string, action: { detail?: string; timing?: string }): string {
  return [
    action.detail?.trim(),
    action.timing ? `Timing: ${action.timing}` : null,
    `From brief: ${briefTitle}`,
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
    return raw.title ?? raw.recommendation?.summary ?? "Daily Briefing";
  }
  return (raw as DailyBriefingLegacy).greeting ?? "Daily Briefing";
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
      toast.error("Enter the corrected belief");
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
      });
      setCorrectedBeliefIds((prev) => {
        const next = new Set(prev);
        next.add(selectedBeliefSource.id);
        return next;
      });
      toast.success("Correction saved. Future briefs will use the replacement belief.");
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
        : dailyBriefingTitle(item.sections).slice(0, 60) || "Briefing Discussion";
      const title = rawTitle.length > 200 ? rawTitle.slice(0, 197) + "..." : rawTitle;
      const thread = await createThreadMut.mutateAsync({ title });
      const context = item.type === "research"
        ? `I'd like to discuss this research report:\n\n**Goal:** ${sections.goal}\n\n${sections.report ?? ""}`
        : `I'd like to discuss today's briefing.`;
      sessionStorage.setItem("pai-chat-auto-send", JSON.stringify({ threadId: thread.id, message: context }));
      navigate(`/ask?thread=${thread.id}`);
    } catch {
      toast.error("Failed to create chat thread");
    } finally {
      setCreating(false);
    }
  };

  const handleKeepWatching = async () => {
    if (!item) return;
    try {
      const draft = item.type === "research"
        ? buildInboxProgramDraft({
            type: "research",
            title: sections.goal ?? "Research follow-through",
            goal: sections.goal,
            executionMode: sections.execution ?? "research",
          })
        : buildInboxProgramDraft({
            type: "daily",
            title: dailyBriefingTitle(item.sections),
            recommendationSummary: isDailyBriefingV2(item.sections) ? item.sections.recommendation?.summary : undefined,
            rationale: isDailyBriefingV2(item.sections) ? item.sections.recommendation?.rationale : undefined,
          });
      await createProgramMut.mutateAsync(draft);
      toast.success("Program created. pai will keep watching this.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create program");
    }
  };

  const handleCreateBriefAction = async (action: { title?: string; detail?: string; timing?: string }) => {
    if (!item || item.type !== "daily" || !action.title) return;
    if (briefLinkedActions.some((task) => task.title === action.title)) {
      toast.message("Action already exists for this brief");
      return;
    }
    try {
      await createTaskMut.mutateAsync({
        title: action.title,
        description: buildBriefActionDescription(dailyBriefingTitle(item.sections), action),
        priority: actionPriorityForTiming(action.timing),
        sourceType: "briefing",
        sourceId: id,
        sourceLabel: dailyBriefingTitle(item.sections),
      });
      toast.success("Action created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create action");
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
        <p className="text-sm text-muted-foreground">Briefing not found</p>
        <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
          <ArrowLeftIcon className="h-4 w-4" /> Back to Inbox
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
            <ArrowLeftIcon className="h-4 w-4" /> Inbox
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
              onClick={handleKeepWatching}
              disabled={createProgramMut.isPending}
              className="gap-2"
            >
              <CalendarClockIcon className="h-4 w-4" />
              {createProgramMut.isPending ? "Creating..." : "Keep watching this"}
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
              <Badge variant="outline" className="text-[10px] border-primary/20 bg-primary/10 text-primary">Daily Briefing</Badge>
            )}
            <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            {item.type === "research" ? (sections.goal ?? "Research Report") : dailyBriefingTitle(item.sections)}
          </h1>
        </div>

        <Separator className="mb-4 opacity-30 md:mb-6" />

        {item.type === "daily" ? (
          <DailyBriefingDetail
            sections={item.sections}
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

        <Dialog
          open={!!selectedBeliefSource}
          onOpenChange={(open) => {
            if (!open) closeCorrectionDialog();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Correct belief</DialogTitle>
              <DialogDescription>
                Replace the belief that influenced this brief. The next brief will use the new belief instead of the old one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border border-border/30 bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current belief</div>
                <p className="mt-1 text-sm text-foreground">{selectedBeliefSource?.statement}</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="belief-correction" className="text-sm font-medium text-foreground">
                  Replacement belief
                </label>
                <Textarea
                  id="belief-correction"
                  value={correctionStatement}
                  onChange={(event) => setCorrectionStatement(event.target.value)}
                  rows={4}
                  placeholder="Describe the corrected belief"
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
  navigate,
  beliefSources,
  linkedActions,
  correctedBeliefIds,
  onCorrectBelief,
  onCreateAction,
}: {
  sections: Record<string, unknown>;
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
  navigate,
  beliefSources,
  linkedActions,
  correctedBeliefIds,
  onCorrectBelief,
  onCreateAction,
}: {
  sections: DailyBriefingV2;
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
          {sections.recommendation?.summary ?? "No recommendation available"}
        </p>
        {sections.recommendation?.rationale && (
          <p className="mt-2 text-sm text-muted-foreground">{sections.recommendation.rationale}</p>
        )}
      </div>

      {(sections.what_changed?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCwIcon className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-semibold text-foreground">What Changed</span>
          </div>
          <div className="space-y-2">
            {sections.what_changed!.map((item, index) => (
              <div key={index} className="rounded-md border border-border/20 bg-card/40 px-4 py-3 text-sm text-muted-foreground">
                {item}
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
              <div
                key={index}
                className="cursor-pointer rounded-md border border-border/20 bg-card/40 p-4 transition-colors hover:border-violet-500/30"
                onClick={() => navigate("/memory")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.statement}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {item.confidence ?? "medium"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{item.provenance}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {beliefSources.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BrainIcon className="h-4 w-4 text-emerald-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Beliefs Behind This Brief</span>
          </div>
          <div className="space-y-3">
            {beliefSources.map((belief) => {
              const corrected = correctedBeliefIds.has(belief.id);
              return (
                <div key={belief.id} className="rounded-md border border-border/20 bg-card/40 p-4">
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
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {belief.subject && belief.subject !== "owner" ? `About ${belief.subject} · ` : ""}
                    Updated {timeAgo(belief.updatedAt)} · Used {belief.accessCount} time{belief.accessCount === 1 ? "" : "s"}
                  </p>
                  {corrected && (
                    <p className="mt-2 text-xs text-emerald-300">
                      Saved as a replacement belief for future briefs.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate("/memory")}>
                      View Memory
                    </Button>
                    <Button size="sm" onClick={() => onCorrectBelief(belief)}>
                      Correct Belief
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
            <span className="font-mono text-sm font-semibold text-foreground">Next Actions</span>
          </div>
          <div className="space-y-3">
            {sections.next_actions!.map((action, index) => (
              <div key={index} className="rounded-md border border-border/20 bg-card/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{action.title}</span>
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
                  {linkedActions.some((task) => task.title === action.title) ? (
                    <Button variant="outline" size="sm" onClick={() => navigate("/tasks")}>
                      Action Added
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => onCreateAction(action)}>
                      Add Action
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {linkedActions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ListTodoIcon className="h-4 w-4 text-amber-400" />
            <span className="font-mono text-sm font-semibold text-foreground">Actions From This Brief</span>
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
              Review Programs
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

function DailyBriefingLegacyDetail({ sections, navigate }: { sections: DailyBriefingLegacy; navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="space-y-4 md:space-y-6">
      {(sections.taskFocus?.items?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2Icon className="h-4 w-4 text-primary" />
            <span className="font-mono text-sm font-semibold text-foreground">Task Focus</span>
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
                  {item.action === "recall" ? "Recall" : item.action === "task" ? "Tasks" : item.action === "learn" ? "Learn" : item.action}
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
  const items: InboxItem[] = inboxData?.briefings ?? [];
  const generating = !!inboxData?.generating;
  const pending = !!inboxData?.pending;
  const busy = generating || pending || refreshInboxMut.isPending;

  // Track generating state transitions via query data
  useEffect(() => {
    if ((prevGeneratingRef.current || prevPendingRef.current) && !inboxData?.generating && !inboxData?.pending) {
      toast.success("Briefing updated!");
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
      toast.success(result.message ?? "Briefing queued");
    } catch {
      toast.error("Failed to start briefing refresh");
    }
  };

  const handleClear = async () => {
    if (!confirm("Clear all inbox items? This cannot be undone.")) return;
    try {
      const result = await clearInboxMut.mutateAsync();
      toast.success(`Cleared ${result.cleared} item${result.cleared !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to clear inbox");
    }
  };

  if (loading) return <InboxSkeleton />;

  if (items.length === 0 && !busy) {
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
              { icon: BrainIcon, label: "Memory", desc: "What I know about you, always evolving" },
              { icon: BookOpenIcon, label: "Knowledge", desc: "Teach me web pages to reference later" },
              { icon: ListTodoIcon, label: "Tasks", desc: "Your to-do list with AI prioritization" },
              { icon: CalendarClockIcon, label: "Programs", desc: "Recurring decisions and commitments pai keeps watching" },
              { icon: InboxIcon, label: "Inbox", desc: "Daily briefings appear here as you use the app" },
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
      <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
        <div className="inbox-fade-in flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-lg font-semibold text-foreground">Inbox</h1>
            <Badge variant="outline" className="text-[10px]">
              {items.length}
            </Badge>
            {unreadCount > 0 && (
              <Badge className="text-[10px] bg-blue-500 text-white hover:bg-blue-600">
                {unreadCount} unread
              </Badge>
            )}
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
            <span className="text-sm text-yellow-300">Briefing queued. Waiting for background slot...</span>
          </div>
        )}

        {generating && (
          <div className="inbox-fade-in flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <LoaderIcon className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-primary">Generating new briefing...</span>
          </div>
        )}

        <Separator className="opacity-30" />

        {items.map((item, idx) => (
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
        ))}

        <div className="h-8" />
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
  if ((sections.next_actions?.length ?? 0) > 0) counts.push(`${sections.next_actions!.length} actions`);

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
                Daily Brief
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
                {sections.recommendation.rationale}
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
                  <span className="font-mono text-xs font-semibold text-foreground">Next Actions</span>
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
    counts.push(`${n} task${n !== 1 ? "s" : ""}`);
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
                Daily Briefing
              </Badge>
              <span className="text-[10px] text-muted-foreground">{timeAgo(item.generatedAt)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground leading-relaxed">
              {sections.greeting ?? "Daily briefing"}
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
                  <span className="font-mono text-xs font-semibold text-foreground">Task Focus</span>
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
                        {s.action === "recall" ? "Recall" : s.action === "task" ? "Tasks" : s.action === "learn" ? "Learn" : s.action}
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
              {sections.goal ?? "Research report"}
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
