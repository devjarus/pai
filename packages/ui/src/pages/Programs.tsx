import { useEffect, useMemo, useState } from "react";

import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarClockIcon,
  ClockIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";

import type { Program } from "../api";
import { FirstVisitBanner } from "../components/FirstVisitBanner";
import {
  useCreateProgram,
  useDeleteProgram,
  usePauseProgram,
  usePrograms,
  useResumeProgram,
  useUpdateProgram,
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
import { formatWithTimezone, parseApiDate } from "@/lib/datetime";

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

function formatInterval(hours: number): string {
  if (hours < 24) return `${hours}h cadence`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Daily cadence";
  if (days === 7) return "Weekly cadence";
  return `${days}d cadence`;
}

function formatDateTime(iso: string): string {
  const parsed = parseApiDate(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return formatWithTimezone(parsed, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: programs = [], isLoading } = usePrograms();
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram();
  const deleteProgram = useDeleteProgram();
  const pauseProgram = usePauseProgram();
  const resumeProgram = useResumeProgram();

  const [showDialog, setShowDialog] = useState(searchParams.get("action") === "add");
  const [editing, setEditing] = useState<Program | null>(null);
  const [deleting, setDeleting] = useState<Program | null>(null);
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
    document.title = "Programs - pai";
    if (searchParams.get("action")) setSearchParams({}, { replace: true });
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
        await updateProgram.mutateAsync({ id: editing.id, data: payload });
        toast.success("Program updated");
      } else {
        await createProgram.mutateAsync(payload);
        toast.success("Program created");
      }
      setShowDialog(false);
      setEditing(null);
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save program");
    }
  }

  async function handleDelete(program: Program) {
    try {
      await deleteProgram.mutateAsync(program.id);
      toast.success("Program deleted");
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete program");
    }
  }

  async function handleTogglePause(program: Program) {
    try {
      if (program.status === "active") {
        await pauseProgram.mutateAsync(program.id);
        toast.success("Program paused");
      } else {
        await resumeProgram.mutateAsync(program.id);
        toast.success("Program resumed");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update program");
    }
  }

  const saving =
    createProgram.isPending ||
    updateProgram.isPending ||
    deleteProgram.isPending ||
    pauseProgram.isPending ||
    resumeProgram.isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FirstVisitBanner
        pageKey="programs"
        tip="Programs are the recurring decisions or commitments you want pai to keep watching and brief you on."
      />
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <CalendarClockIcon className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Programs</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {activeCount} active{pausedCount > 0 ? `, ${pausedCount} paused` : ""}
            </span>
          )}
        </div>
        <Button size="sm" onClick={openAdd}>
          <PlusIcon className="mr-1 size-4" />
          New Program
        </Button>
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
              <p className="text-lg font-medium text-foreground">No programs yet</p>
              <p className="mt-1 max-w-md text-sm">
                Create an ongoing decision or commitment and pai will keep watching it, remember your constraints,
                and brief you when something changes.
              </p>
            </div>
            <Button variant="outline" onClick={openAdd}>
              <PlusIcon className="mr-1 size-4" />
              Create Program
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {programs.map((program) => (
              <ProgramRow
                key={program.id}
                program={program}
                onEdit={openEdit}
                onDelete={setDeleting}
                onTogglePause={handleTogglePause}
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
            <DialogTitle>{editing ? "Edit Program" : "New Program"}</DialogTitle>
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
              <label className="mb-1 block text-sm font-medium">Recurring Question Or Commitment</label>
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
                <label className="mb-1 block text-sm font-medium">Brief Depth</label>
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
                First Brief At <span className="font-normal text-muted-foreground">(optional)</span>
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
              disabled={saving || !form.title.trim() || !form.question.trim()}
            >
              {saving ? "Saving..." : editing ? "Save Changes" : "Create Program"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Program</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            Delete "{deleting?.title}"? This stops future follow-through for the program.
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
    </div>
  );
}

function ProgramRow({
  program,
  onEdit,
  onDelete,
  onTogglePause,
}: {
  program: Program;
  onEdit: (program: Program) => void;
  onDelete: (program: Program) => void;
  onTogglePause: (program: Program) => void;
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
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {!isPaused && (
              <span>
                Next brief: {formatDateTime(program.nextRunAt)} ({timeUntil(program.nextRunAt)})
              </span>
            )}
            {program.lastRunAt && <span>Last brief: {formatDateTime(program.lastRunAt)}</span>}
            <span className="font-mono text-[10px] opacity-50">{program.id}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
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
