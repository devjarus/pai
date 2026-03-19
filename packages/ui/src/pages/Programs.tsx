import { useEffect, useMemo, useState } from "react";

import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarClockIcon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  LayoutTemplateIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";

import type { Program } from "../api";
import type { ResearchFinding } from "../types";
import { FirstVisitBanner } from "../components/FirstVisitBanner";
import {
  useCreateProgram,
  useDeleteProgram,
  usePauseProgram,
  usePrograms,
  useResumeProgram,
  useUpdateProgram,
  useWatches,
  useCreateWatch,
  useCreateWatchFromTemplate,
  useUpdateWatch,
  useDeleteWatch,
  usePauseWatch,
  useResumeWatch,
  useWatchTemplates,
  useTriggerWatchRun,
  useFindings,
} from "@/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatInterval, parseApiDate } from "@/lib/datetime";

type ProgramFamily = Program["family"];
type ExecutionMode = Program["executionMode"];

const familyOptions: Array<{ value: ProgramFamily; label: string }> = [
  { value: "general", label: "General" },
  { value: "work", label: "Work" },
  { value: "travel", label: "Travel" },
  { value: "buying", label: "Buying" },
];

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function linesValue(values: string[]): string {
  return values.join("\n");
}


function timeUntil(iso: string): string {
  const diff = parseApiDate(iso).getTime() - Date.now();
  if (diff < 0) return "due now";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `in ${Math.round(hours / 24)}d`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

function familyTone(family: ProgramFamily): string {
  switch (family) {
    case "work":
      return "border-blue-500/20 bg-blue-500/10 text-blue-300";
    case "travel":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "buying":
      return "border-amber-500/20 bg-amber-500/10 text-amber-300";
    default:
      return "border-border/40 bg-background/60 text-muted-foreground";
  }
}

export default function Programs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Use the watches API with fallback to programs API
  const watchesQuery = useWatches();
  const programsQuery = usePrograms();
  const programs = watchesQuery.data ?? programsQuery.data ?? [];
  const isLoading = watchesQuery.isLoading && programsQuery.isLoading;

  // Watches mutations (primary)
  const createWatch = useCreateWatch();
  const createWatchFromTemplate = useCreateWatchFromTemplate();
  const updateWatch = useUpdateWatch();
  const deleteWatch = useDeleteWatch();
  const pauseWatch = usePauseWatch();
  const resumeWatch = useResumeWatch();
  const triggerRun = useTriggerWatchRun();

  // Keep program mutations as fallback
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram();
  const deleteProgram = useDeleteProgram();
  const pauseProgram = usePauseProgram();
  const resumeProgram = useResumeProgram();

  const [showDialog, setShowDialog] = useState(searchParams.get("action") === "add");
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<Program | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "findings">("overview");
  const [editing, setEditing] = useState<Program | null>(null);
  const [deleting, setDeleting] = useState<Program | null>(null);
  const [templateForm, setTemplateForm] = useState({ templateId: "", subject: "" });
  const [form, setForm] = useState({
    title: "",
    question: "",
    family: "general" as ProgramFamily,
    executionMode: "research" as ExecutionMode,
    intervalHours: "24",
    startAt: "",
    preferences: "",
    constraints: "",
    openQuestions: "",
  });

  useEffect(() => {
    document.title = "Watches - pai";
    if (searchParams.get("action")) {
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = useMemo(
    () => programs.filter((program) => program.status === "active").length,
    [programs],
  );
  const pausedCount = useMemo(
    () => programs.filter((program) => program.status === "paused").length,
    [programs],
  );

  function resetForm() {
    setForm({
      title: "",
      question: "",
      family: "general",
      executionMode: "research",
      intervalHours: "24",
      startAt: "",
      preferences: "",
      constraints: "",
      openQuestions: "",
    });
  }

  function openAdd() {
    setEditing(null);
    resetForm();
    setShowDialog(true);
  }

  function openEdit(program: Program) {
    setEditing(program);
    setForm({
      title: program.title,
      question: program.question,
      family: program.family,
      executionMode: program.executionMode,
      intervalHours: String(program.intervalHours),
      startAt: "",
      preferences: linesValue(program.preferences),
      constraints: linesValue(program.constraints),
      openQuestions: linesValue(program.openQuestions),
    });
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.question.trim()) return;
    const payload = {
      title: form.title.trim(),
      question: form.question.trim(),
      family: form.family,
      executionMode: form.executionMode,
      intervalHours: parseInt(form.intervalHours, 10) || 24,
      ...(form.startAt ? { startAt: new Date(form.startAt).toISOString() } : {}),
      preferences: parseLines(form.preferences),
      constraints: parseLines(form.constraints),
      openQuestions: parseLines(form.openQuestions),
    };

    try {
      if (editing) {
        await updateWatch.mutateAsync({ id: editing.id, data: payload });
        toast.success("Watch updated");
      } else {
        const result = await createWatch.mutateAsync(payload);
        toast.success(
          result.created
            ? "Watch created"
            : result.duplicateReason === "thread"
              ? "That thread is already being watched"
              : `Already watching this as "${result.watch.title}"`,
        );
      }
      setShowDialog(false);
      setEditing(null);
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save watch");
    }
  }

  async function handleDelete(program: Program) {
    try {
      await deleteWatch.mutateAsync(program.id);
      toast.success("Watch deleted");
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete watch");
    }
  }

  async function handleTogglePause(program: Program) {
    try {
      if (program.status === "active") {
        await pauseWatch.mutateAsync(program.id);
        toast.success("Watch paused");
      } else {
        await resumeWatch.mutateAsync(program.id);
        toast.success("Watch resumed");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update watch");
    }
  }

  async function handleCreateFromTemplate() {
    if (!templateForm.templateId || !templateForm.subject.trim()) return;
    try {
      const result = await createWatchFromTemplate.mutateAsync({
        templateId: templateForm.templateId,
        subject: templateForm.subject.trim(),
      });
      toast.success(
        result.created
          ? "Watch created from template"
          : `Already watching this as "${result.watch.title}"`,
      );
      setShowTemplateDialog(false);
      setTemplateForm({ templateId: "", subject: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create watch from template");
    }
  }

  async function handleTriggerRun(program: Program) {
    try {
      await triggerRun.mutateAsync(program.id);
      toast.success("Watch run triggered");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to trigger watch run");
    }
  }

  function openProgramPrimary(program: Program) {
    if (program.latestBriefSummary?.id) {
      navigate(`/inbox/${program.latestBriefSummary.id}`);
      return;
    }
    navigate("/ask");
  }

  const programSaving =
    createWatch.isPending ||
    createWatchFromTemplate.isPending ||
    updateWatch.isPending ||
    deleteWatch.isPending ||
    pauseWatch.isPending ||
    resumeWatch.isPending ||
    triggerRun.isPending ||
    createProgram.isPending ||
    updateProgram.isPending ||
    deleteProgram.isPending ||
    pauseProgram.isPending ||
    resumeProgram.isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FirstVisitBanner
        pageKey="programs"
        tip="Watches are the recurring decisions or topics you want pai to keep watching and send you digests on."
      />
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <CalendarClockIcon className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Watches</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {activeCount} active{pausedCount > 0 ? `, ${pausedCount} paused` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowTemplateDialog(true)}>
            <LayoutTemplateIcon className="mr-1 size-4" />
            From Template
          </Button>
          <Button size="sm" onClick={openAdd}>
            <PlusIcon className="mr-1 size-4" />
            New Watch
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-xl border p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-3/4" />
              </div>
            ))}
          </div>
        ) : programs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center text-muted-foreground">
            <SparklesIcon className="size-10 opacity-40" />
            <div>
              <p className="text-lg font-medium text-foreground">No watches yet</p>
              <p className="mt-1 max-w-md text-sm">
                Create an ongoing decision or watch and pai will keep watching it, remember your constraints,
                and send you a digest when something changes.
              </p>
            </div>
            <Button variant="outline" onClick={openAdd}>
              <PlusIcon className="mr-1 size-4" />
              Create Watch
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {programs.map((program) => (
              <ProgramRow
                key={program.id}
                program={program}
                onOpenPrimary={openProgramPrimary}

                onEdit={openEdit}
                onDelete={setDeleting}
                onTogglePause={handleTogglePause}
                onOpenDetail={(p) => { setSelectedDetail(p); setDetailTab("overview"); }}
                onTriggerRun={handleTriggerRun}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowDialog(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Watch" : "New Watch"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Title</label>
                <input
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Project Atlas launch readiness"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Family</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={form.family}
                  onChange={(event) => setForm((current) => ({ ...current, family: event.target.value as ProgramFamily }))}
                >
                  {familyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Recurring Question Or Watch</label>
              <textarea
                rows={4}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Keep track of Project Atlas launch readiness. I care most about release blockers, rollback readiness, and docs signoff."
                value={form.question}
                onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Digest Depth</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={form.executionMode}
                  onChange={(event) => setForm((current) => ({ ...current, executionMode: event.target.value as ExecutionMode }))}
                >
                  <option value="research">Standard watch</option>
                  <option value="analysis">Deep analysis</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Cadence</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={form.intervalHours}
                  onChange={(event) => setForm((current) => ({ ...current, intervalHours: event.target.value }))}
                >
                  <option value="6">Every 6 hours</option>
                  <option value="12">Every 12 hours</option>
                  <option value="24">Daily</option>
                  <option value="48">Every 2 days</option>
                  <option value="168">Weekly</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Preferences</label>
                <textarea
                  rows={4}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="One per line"
                  value={form.preferences}
                  onChange={(event) => setForm((current) => ({ ...current, preferences: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Constraints</label>
                <textarea
                  rows={4}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="One per line"
                  value={form.constraints}
                  onChange={(event) => setForm((current) => ({ ...current, constraints: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Open Questions</label>
                <textarea
                  rows={4}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="One per line"
                  value={form.openQuestions}
                  onChange={(event) => setForm((current) => ({ ...current, openQuestions: event.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                First Digest At <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.startAt}
                onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={programSaving || !form.title.trim() || !form.question.trim()}
            >
              {programSaving ? "Saving..." : editing ? "Save Changes" : "Create Watch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Watch</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            Delete "{deleting?.title}"? This stops future digests for the watch and leaves any to-dos as history.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && handleDelete(deleting)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create from Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Watch from Template</DialogTitle>
          </DialogHeader>
          <TemplateCreateForm
            form={templateForm}
            onChange={setTemplateForm}
            onSubmit={handleCreateFromTemplate}
            isPending={createWatchFromTemplate.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Watch Detail Dialog */}
      <Dialog open={!!selectedDetail} onOpenChange={(open) => { if (!open) setSelectedDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedDetail?.title ?? "Watch Detail"}</DialogTitle>
          </DialogHeader>
          {selectedDetail && (
            <WatchDetailView
              watch={selectedDetail}
              activeTab={detailTab}
              onTabChange={setDetailTab}
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

function ProgramRow({
  program,
  onOpenPrimary,
  onEdit,
  onDelete,
  onTogglePause,
  onOpenDetail,
  onTriggerRun,
}: {
  program: Program;
  onOpenPrimary: (program: Program) => void;
  onEdit: (program: Program) => void;
  onDelete: (program: Program) => void;
  onTogglePause: (program: Program) => void;
  onOpenDetail: (program: Program) => void;
  onTriggerRun: (program: Program) => void;
}) {
  const isPaused = program.status === "paused";
  const visibleSignals = [...program.preferences.slice(0, 2), ...program.constraints.slice(0, 2)].slice(0, 3);
  return (
    <div
      className={`group rounded-xl border border-border/40 bg-card/40 p-4 transition-colors hover:bg-muted/30 ${isPaused ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <ClockIcon className={`size-5 ${isPaused ? "text-muted-foreground" : "text-primary"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{program.title}</span>
            <Badge variant="outline" className={`text-[10px] ${familyTone(program.family)}`}>
              {program.family}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {formatInterval(program.intervalHours)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {program.executionMode === "analysis" ? "Deep analysis" : "Standard watch"}
            </Badge>
            {isPaused && <Badge variant="secondary" className="text-[10px]">Paused</Badge>}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{program.question}</p>
          {visibleSignals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {visibleSignals.map((signal) => (
                <span
                  key={signal}
                  className="rounded-full border border-border/40 bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  {signal}
                </span>
              ))}
            </div>
          )}
          {/* Latest digest summary — clean, no to-dos here */}
          {program.latestBriefSummary?.id && (
            <div className="mt-4 rounded-lg border border-border/30 bg-background/50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-muted-foreground">Latest digest</div>
                  <p className="mt-1 text-sm text-foreground line-clamp-2">
                    {program.latestBriefSummary.recommendationSummary ?? "No recommendation yet"}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => onOpenPrimary(program)}>
                  Open Digest
                </Button>
              </div>
            </div>
          )}
          {/* Activity indicator — show when research/swarm is running */}
          {program.actionSummary && program.actionSummary.openCount > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block size-2 animate-pulse rounded-full bg-primary" />
              {program.actionSummary.openCount} open to-do{program.actionSummary.openCount !== 1 ? "s" : ""} — view in Tasks
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {!isPaused && (
              <span>
                Next digest: {formatDateTime(program.nextRunAt)} ({timeUntil(program.nextRunAt)})
              </span>
            )}
            {program.lastRunAt && <span>Last digest: {formatDateTime(program.lastRunAt)}</span>}
            <span className="font-mono text-[10px] opacity-50">{program.id}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onOpenDetail(program)}
            title="View details & findings"
          >
            <EyeIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onTriggerRun(program)}
            title="Run now"
          >
            <SearchIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onTogglePause(program)}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onEdit(program)}
            title="Edit"
          >
            <PencilIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive"
            onClick={() => onDelete(program)}
            title="Delete"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TemplateCreateForm({
  form,
  onChange,
  onSubmit,
  isPending,
}: {
  form: { templateId: string; subject: string };
  onChange: (form: { templateId: string; subject: string }) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const { data: templates = [], isLoading } = useWatchTemplates();

  return (
    <div className="grid gap-4 py-2">
      <div>
        <label className="mb-1 block text-sm font-medium">Template</label>
        {isLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={form.templateId}
            onChange={(e) => onChange({ ...form, templateId: e.target.value })}
          >
            <option value="">Select a template...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} -- {t.description}
              </option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Subject</label>
        <input
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="e.g. MacBook Pro M4, Tesla stock, competitor Acme Inc."
          value={form.subject}
          onChange={(e) => onChange({ ...form, subject: e.target.value })}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          The subject will be inserted into the template's question.
        </p>
      </div>
      <DialogFooter>
        <Button
          onClick={onSubmit}
          disabled={isPending || !form.templateId || !form.subject.trim()}
        >
          {isPending ? "Creating..." : "Create Watch"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function WatchDetailView({
  watch,
  activeTab,
  onTabChange,
}: {
  watch: Program;
  activeTab: "overview" | "findings";
  onTabChange: (tab: "overview" | "findings") => void;
}) {
  const { data: findings = [], isLoading: findingsLoading } = useFindings(watch.id);

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
        <button
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "overview" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onTabChange("overview")}
        >
          <FileTextIcon className="mr-1.5 inline size-3.5" />
          Overview
        </button>
        <button
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "findings" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onTabChange("findings")}
        >
          <SearchIcon className="mr-1.5 inline size-3.5" />
          Findings
          {findings.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {findings.length}
            </Badge>
          )}
        </button>
      </div>

      {activeTab === "overview" && (
        <div className="space-y-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs font-medium text-muted-foreground uppercase">Question</div>
            <p className="mt-1 text-sm">{watch.question}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">Status</div>
              <p className="mt-1 text-sm font-medium capitalize">{watch.status}</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">Cadence</div>
              <p className="mt-1 text-sm">{formatInterval(watch.intervalHours)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">Next Digest</div>
              <p className="mt-1 text-sm">{formatDateTime(watch.nextRunAt)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">Last Digest</div>
              <p className="mt-1 text-sm">{watch.lastRunAt ? formatDateTime(watch.lastRunAt) : "Never"}</p>
            </div>
          </div>
          {watch.latestBriefSummary?.recommendationSummary && (
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">Latest Digest Summary</div>
              <p className="mt-1 text-sm">{watch.latestBriefSummary.recommendationSummary}</p>
            </div>
          )}
          {watch.preferences.length > 0 && (
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">Preferences</div>
              <ul className="mt-1 space-y-1">
                {watch.preferences.map((p) => (
                  <li key={p} className="text-sm text-muted-foreground">{p}</li>
                ))}
              </ul>
            </div>
          )}
          {watch.constraints.length > 0 && (
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">Constraints</div>
              <ul className="mt-1 space-y-1">
                {watch.constraints.map((c) => (
                  <li key={c} className="text-sm text-muted-foreground">{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {activeTab === "findings" && (
        <div className="space-y-3">
          {findingsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : findings.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No findings yet. Findings appear after the watch runs its first research cycle.
            </div>
          ) : (
            findings.map((finding: ResearchFinding) => (
              <div key={finding.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{finding.domain}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {finding.depthLevel}
                      </Badge>
                      {finding.confidence > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {Math.round(finding.confidence * 100)}% confidence
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{finding.summary}</p>
                    {finding.delta && finding.delta.changed.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {finding.delta.changed.map((change) => (
                          <Badge key={change} variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                            {change}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {finding.sources.length > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {finding.sources.length} source{finding.sources.length !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  {finding.agentName} -- {formatDateTime(finding.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
