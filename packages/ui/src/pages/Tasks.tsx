import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useCompleteTask,
  useReopenTask,
  useSnoozeTask,
  useUnsnoozeTask,
  useDeleteTask,
  useClearAllTasks,
  useGoals,
  useCompleteGoal,
  useDeleteGoal,
} from "@/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusIcon,
  Trash2Icon,
  PencilIcon,
  CheckCircle2Icon,
  CircleIcon,
  TargetIcon,
  CalendarIcon,
  ClockIcon,
  BellIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Task, Goal } from "../types";
import { QueryError } from "@/components/QueryError";
import { FirstVisitBanner } from "../components/FirstVisitBanner";
import { formatDate, parseApiDate } from "@/lib/datetime";

type FollowThroughSource = "briefing" | "program";

function isOverdue(dueDateStr: string): boolean {
  const due = parseApiDate(dueDateStr);
  if (isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function isSnoozedActive(snoozedUntil: string | null): boolean {
  if (!snoozedUntil) return false;
  const target = parseApiDate(snoozedUntil);
  if (isNaN(target.getTime())) return false;
  return target.getTime() > Date.now();
}

type SnoozeQuickOption = { label: string; value: () => Date };

const SNOOZE_QUICK_OPTIONS: SnoozeQuickOption[] = [
  {
    label: "Later today",
    value: () => {
      const d = new Date();
      d.setHours(d.getHours() + 3, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Tomorrow morning",
    value: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Next week",
    value: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const priorityStyles: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-yellow-500/15 text-yellow-400",
  low: "bg-muted text-muted-foreground",
};

function taskSourceLabel(task: Task): string | null {
  if (!task.source_type) return null;
  const prefix = task.source_type === "program" ? "From Watch" : "From Digest";
  return task.source_label ? `${prefix}: ${task.source_label}` : prefix;
}

export default function Tasks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<"actions" | "goals">("actions");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const sourceTypeParam = searchParams.get("sourceType");
  const sourceTypeFilter: FollowThroughSource | undefined =
    sourceTypeParam === "program" || sourceTypeParam === "briefing" ? sourceTypeParam : undefined;
  const sourceIdFilter = searchParams.get("sourceId") ?? undefined;
  const sourceLabelFilter = searchParams.get("sourceLabel") ?? undefined;
  const scopedSource: { sourceType: FollowThroughSource; sourceId: string } | undefined =
    sourceTypeFilter && sourceIdFilter ? { sourceType: sourceTypeFilter, sourceId: sourceIdFilter } : undefined;

  const [showAddTask, setShowAddTask] = useState(searchParams.get("action") === "add");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    dueDate: "",
    goalId: "",
  });

  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const [showClearAll, setShowClearAll] = useState(false);
  const [customSnoozeTask, setCustomSnoozeTask] = useState<Task | null>(null);
  const [customSnoozeValue, setCustomSnoozeValue] = useState("");

  const [quickAddTitle, setQuickAddTitle] = useState("");

  useEffect(() => {
    document.title = "To-Dos - pai";
    if (searchParams.get("action")) {
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- TanStack Query hooks ---
  const taskQuery: { status?: string; sourceType?: FollowThroughSource; sourceId?: string } = { status: statusFilter };
  if (scopedSource) {
    taskQuery.sourceType = scopedSource.sourceType;
    taskQuery.sourceId = scopedSource.sourceId;
  }
  const { data: tasks = [], isLoading: tasksLoading, isError: tasksError, refetch: tasksRefetch } = useTasks(taskQuery);
  const { data: allTasks = [], isLoading: allTasksLoading } = useTasks({ status: "all" });
  const { data: goals = [], isLoading: goalsLoading } = useGoals("all");

  const loading = tasksLoading || allTasksLoading || goalsLoading;

  const createTaskMut = useCreateTask();
  const updateTaskMut = useUpdateTask();
  const completeTaskMut = useCompleteTask();
  const reopenTaskMut = useReopenTask();
  const snoozeTaskMut = useSnoozeTask();
  const unsnoozeTaskMut = useUnsnoozeTask();
  const deleteTaskMut = useDeleteTask();
  const clearAllTasksMut = useClearAllTasks();

  const completeGoalMut = useCompleteGoal();
  const deleteGoalMut = useDeleteGoal();

  useEffect(() => {
    if (activeTab === "goals" && goals.length === 0) {
      setActiveTab("actions");
    }
  }, [activeTab, goals.length]);

  const scopedSourceLabel =
    sourceLabelFilter ??
    tasks.find((task) => task.source_label)?.source_label ??
    (sourceTypeFilter === "program" ? "Watch" : sourceTypeFilter === "briefing" ? "Digest" : undefined);

  const scopedSourceKind =
    sourceTypeFilter === "program" ? "Watch" : sourceTypeFilter === "briefing" ? "Digest" : null;

  const clearSourceFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("sourceType");
    next.delete("sourceId");
    next.delete("sourceLabel");
    setSearchParams(next, { replace: true });
  };

  // --- Task handlers ---

  const handleToggleTask = async (task: Task) => {
    try {
      if (task.status === "open") {
        await completeTaskMut.mutateAsync(task.id);
        toast.success("To-do marked done");
      } else {
        await reopenTaskMut.mutateAsync(task.id);
        toast.success("To-do reopened");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update to-do",
      );
    }
  };

  const handleQuickSnooze = async (task: Task, target: Date) => {
    try {
      await snoozeTaskMut.mutateAsync({ id: task.id, until: target.toISOString() });
      toast.success(`Snoozed until ${formatDate(target.toISOString())}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to snooze to-do");
    }
  };

  const openCustomSnooze = (task: Task) => {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 1);
    defaultDate.setHours(9, 0, 0, 0);
    setCustomSnoozeValue(toLocalDatetimeInputValue(defaultDate));
    setCustomSnoozeTask(task);
  };

  const handleCustomSnoozeSave = async () => {
    if (!customSnoozeTask) return;
    if (!customSnoozeValue) {
      toast.error("Pick a snooze target");
      return;
    }
    const target = new Date(customSnoozeValue);
    if (Number.isNaN(target.getTime())) {
      toast.error("Invalid snooze target");
      return;
    }
    if (target.getTime() <= Date.now()) {
      toast.error("Snooze target must be in the future");
      return;
    }
    try {
      await snoozeTaskMut.mutateAsync({ id: customSnoozeTask.id, until: target.toISOString() });
      toast.success(`Snoozed until ${formatDate(target.toISOString())}`);
      setCustomSnoozeTask(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to snooze to-do");
    }
  };

  const handleUnsnooze = async (task: Task) => {
    try {
      await unsnoozeTaskMut.mutateAsync(task.id);
      toast.success("Snooze cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear snooze");
    }
  };

  const handleDeleteTask = async (task: Task) => {
    try {
      await deleteTaskMut.mutateAsync(task.id);
      toast.success("To-do deleted");
      setDeletingTask(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete to-do",
      );
    }
  };

  const openAddTask = () => {
    setTaskForm({
      title: "",
      description: "",
      priority: "medium",
      dueDate: "",
      goalId: "",
    });
    setEditingTask(null);
    setShowAddTask(true);
  };

  const openEditTask = (task: Task) => {
    setTaskForm({
      title: task.title,
      description: task.description ?? "",
      priority: task.priority,
      dueDate: task.due_date?.split(" ")[0] ?? "",
      goalId: task.goal_id ?? "",
    });
    setEditingTask(task);
    setShowAddTask(true);
  };

  const handleSaveTask = async () => {
    const title = taskForm.title.trim();
    if (!title) return;
    try {
      if (editingTask) {
        await updateTaskMut.mutateAsync({
          id: editingTask.id,
          updates: {
            title,
            priority: taskForm.priority,
            dueDate: taskForm.dueDate || undefined,
            description: taskForm.description.trim() || undefined,
            goalId: taskForm.goalId || undefined,
          },
        });
        toast.success("To-do updated");
      } else {
        await createTaskMut.mutateAsync({
          title,
          description: taskForm.description.trim() || undefined,
          priority: taskForm.priority,
          dueDate: taskForm.dueDate || undefined,
          goalId: taskForm.goalId || undefined,
          ...(scopedSource ? {
            sourceType: scopedSource.sourceType,
            sourceId: scopedSource.sourceId,
            sourceLabel: scopedSourceLabel,
          } : {}),
        });
        toast.success("To-do saved");
      }
      setShowAddTask(false);
      setEditingTask(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save to-do");
    }
  };

  const isSavingTask = createTaskMut.isPending || updateTaskMut.isPending;

  const handleQuickAdd = async () => {
    const title = quickAddTitle.trim();
    if (!title) return;
    try {
      await createTaskMut.mutateAsync({
        title,
        priority: "medium",
        ...(scopedSource ? {
          sourceType: scopedSource.sourceType,
          sourceId: scopedSource.sourceId,
          sourceLabel: scopedSourceLabel,
        } : {}),
      });
      setQuickAddTitle("");
      toast.success("To-do saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save to-do");
    }
  };

  const handleCompleteGoal = async (goal: Goal) => {
    try {
      await completeGoalMut.mutateAsync(goal.id);
      toast.success("Legacy goal completed");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to complete legacy goal",
      );
    }
  };

  const handleDeleteGoal = async (goal: Goal) => {
    try {
      await deleteGoalMut.mutateAsync(goal.id);
      toast.success("Legacy goal deleted");
      setDeletingGoal(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete legacy goal",
      );
    }
  };

  const handleClearAllTasks = async () => {
    try {
      const result = await clearAllTasksMut.mutateAsync();
      toast.success(`Cleared ${result.cleared} to-do${result.cleared !== 1 ? "s" : ""}`);
      setShowClearAll(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear to-dos");
    }
  };

  // --- Goal progress helpers ---

  const getGoalProgress = (goalId: string) => {
    const goalTasks = allTasks.filter((t) => t.goal_id === goalId);
    const doneTasks = goalTasks.filter((t) => t.status === "done");
    return { total: goalTasks.length, done: doneTasks.length };
  };

  // --- Goal name lookup ---

  const goalNameMap = goals.reduce(
    (acc, g) => {
      acc[g.id] = g.title;
      return acc;
    },
    {} as Record<string, string>,
  );

  const activeGoals = goals.filter((g) => g.status === "active");
  const doneGoals = goals.filter((g) => g.status === "done");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <FirstVisitBanner pageKey="tasks" tip="To-dos are optional and user-owned. Save one only when there is a real manual step you want pai to revisit in future digests." />
      {/* Top-level tabs */}
      <header className="space-y-2 border-b border-border/40 bg-background px-3 py-3 md:space-y-4 md:px-6 md:py-4">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "actions" | "goals")}
        >
            <TabsList className="h-8">
              <TabsTrigger value="actions" className="text-xs">
              To-Dos
              </TabsTrigger>
            {goals.length > 0 && (
              <TabsTrigger value="goals" className="text-xs">
                Legacy Goals
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>

        {/* Tab-specific header */}
        {activeTab === "actions" ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="shrink-0 font-mono text-sm font-semibold text-foreground">
                  To-Dos
                </h1>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {tasks.length} to-do{tasks.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={openAddTask}>
                  <PlusIcon className="size-4 text-muted-foreground" />
                </Button>
                {tasks.length > 0 && (
                  <Button variant="ghost" size="icon-xs" onClick={() => setShowClearAll(true)}>
                    <Trash2Icon className="size-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            </div>

            {/* Status filter */}
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList className="h-8">
                <TabsTrigger value="open" className="text-xs">
                  Open
                </TabsTrigger>
                <TabsTrigger value="snoozed" className="text-xs">
                  Snoozed
                </TabsTrigger>
                <TabsTrigger value="done" className="text-xs">
                  Done
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs">
                  All
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {scopedSource && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  Showing to-dos for {scopedSourceKind}: <span className="font-medium text-foreground">{scopedSourceLabel}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={clearSourceFilter}>
                  Show all
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div>
                <h1 className="shrink-0 font-mono text-sm font-semibold text-foreground">
                  Legacy Goals
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Goals are deprecated. Existing goals remain here for reference and cleanup, but new to-dos should only come from Digests or explicit user intent when there is a real manual step to keep alive.
                </p>
              </div>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {activeGoals.length} active
              </Badge>
            </div>
          </div>
        )}
      </header>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4 md:p-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 p-4"
                >
                  <Skeleton className="size-5 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : tasksError ? (
            <QueryError message="Failed to load to-dos." onRetry={tasksRefetch} />
          ) : activeTab === "actions" ? (
            tasks.length === 0 && !quickAddTitle ? (
              <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
                <CircleIcon className="mb-4 size-12 opacity-20" />
                <p>No to-dos found.</p>
                <p className="mt-1 text-xs">
                  {scopedSource
                    ? `No to-dos exist for this ${scopedSourceKind?.toLowerCase() ?? "source"} yet.`
                    : statusFilter === "open"
                      ? 'Click the + button to add your first to-do, or switch to "All" to see completed to-dos.'
                      : statusFilter === "snoozed"
                        ? "No snoozed to-dos. Snooze a to-do from the open list to defer it."
                        : "No to-dos match the current filter."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={quickAddTitle}
                  onChange={(e) => setQuickAddTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleQuickAdd();
                  }}
                  placeholder={scopedSource ? "Add a to-do for this context..." : "Quick-add a to-do..."}
                  className="w-full rounded-lg border-transparent bg-transparent px-4 py-2 text-xs text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-border/40 focus:bg-card/30 focus:ring-0"
                />
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    goalName={
                      task.goal_id ? goalNameMap[task.goal_id] : undefined
                    }
                    onToggle={handleToggleTask}
                    onEdit={openEditTask}
                    onDelete={setDeletingTask}
                    onQuickSnooze={handleQuickSnooze}
                    onCustomSnooze={openCustomSnooze}
                    onUnsnooze={handleUnsnooze}
                  />
                ))}
              </div>
            )
          ) : goals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
              <TargetIcon className="mb-4 size-12 opacity-20" />
              <p>No legacy goals.</p>
              <p className="mt-1 text-xs">
                Existing goals would appear here for cleanup, but new product work should live as Watches, Digests, and to-dos.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeGoals.map((goal) => {
                const progress = getGoalProgress(goal.id);
                const pct =
                  progress.total > 0
                    ? Math.round((progress.done / progress.total) * 100)
                    : 0;
                return (
                  <div
                    key={goal.id}
                    className="rounded-lg border border-border/40 bg-card/50 p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium leading-tight text-foreground/90">
                          {goal.title}
                        </h3>
                        {goal.description && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {goal.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-green-400"
                          onClick={() => handleCompleteGoal(goal)}
                        >
                          <CheckCircle2Icon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeletingGoal(goal)}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    </div>

                      <p className="mb-2 text-xs text-muted-foreground">
                      {progress.done}/{progress.total} linked to-do{progress.total === 1 ? "" : "s"} done
                    </p>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {doneGoals.length > 0 && (
                <>
                  {activeGoals.length > 0 && (
                    <div className="pt-2 text-xs text-muted-foreground/60">Completed</div>
                  )}
                  {doneGoals.map((goal) => {
                    const progress = getGoalProgress(goal.id);
                    const pct =
                      progress.total > 0
                        ? Math.round((progress.done / progress.total) * 100)
                        : 0;
                    return (
                      <div
                        key={goal.id}
                        className="rounded-lg border border-border/40 bg-card/50 p-4 opacity-50 transition-colors hover:bg-accent/50"
                      >
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-medium leading-tight text-muted-foreground line-through">
                              {goal.title}
                            </h3>
                            {goal.description && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {goal.description}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeletingGoal(goal)}
                            >
                              <Trash2Icon className="size-4" />
                            </Button>
                          </div>
                        </div>

                        <p className="mb-2 text-xs text-muted-foreground">
                          {progress.done}/{progress.total} linked to-do{progress.total === 1 ? "" : "s"} done
                        </p>
                        <div className="h-1.5 w-full rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Task Dialog */}
      <Dialog
        open={showAddTask}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddTask(false);
            setEditingTask(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">
              {editingTask ? "Edit To-Do" : "Add To-Do"}
              </DialogTitle>
            </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Title
              </label>
              <input
                type="text"
                value={taskForm.title}
                onChange={(e) =>
                  setTaskForm((f) => ({ ...f, title: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTask();
                }}
                placeholder="What concrete step should stay alive?"
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Description
              </label>
              <textarea
                value={taskForm.description}
                onChange={(e) =>
                  setTaskForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Why this to-do matters, deadline context, or what future digests should remember..."
                rows={3}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              />
            </div>

            {scopedSource && (
              <div className="rounded-lg border border-border/40 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
                Linked to {scopedSourceKind}: <span className="font-medium text-foreground">{scopedSourceLabel}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Priority
                </label>
                <select
                  value={taskForm.priority}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, priority: e.target.value }))
                  }
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Due date
                </label>
                <input
                  type="date"
                  value={taskForm.dueDate}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, dueDate: e.target.value }))
                  }
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                />
              </div>
            </div>

            {(activeGoals.length > 0 || !!editingTask?.goal_id) && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Legacy goal link
                </label>
                <select
                  value={taskForm.goalId}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, goalId: e.target.value }))
                  }
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                >
                  <option value="">No legacy goal</option>
                  {activeGoals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAddTask(false);
                setEditingTask(null);
              }}
              disabled={isSavingTask}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveTask}
              disabled={isSavingTask || !taskForm.title.trim()}
            >
              {isSavingTask
                ? "Saving..."
                : editingTask
                  ? "Save Changes"
                  : "Add To-Do"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Task Confirmation */}
      <ConfirmDialog
        open={!!deletingTask}
        onOpenChange={(open) => { if (!open) setDeletingTask(null); }}
        title="Delete To-Do"
        confirmLabel="Delete"
        onConfirm={() => deletingTask && handleDeleteTask(deletingTask)}
      >
        Delete{" "}
        <strong className="text-foreground/80">
          &quot;{deletingTask?.title}&quot;
        </strong>
        ? This cannot be undone.
      </ConfirmDialog>

      {/* Delete Goal Confirmation */}
      <ConfirmDialog
        open={!!deletingGoal}
        onOpenChange={(open) => { if (!open) setDeletingGoal(null); }}
        title="Delete Legacy Goal"
        confirmLabel="Delete"
        onConfirm={() => deletingGoal && handleDeleteGoal(deletingGoal)}
      >
        Delete{" "}
        <strong className="text-foreground/80">
          &quot;{deletingGoal?.title}&quot;
        </strong>
        ? Linked to-dos will not be deleted.
      </ConfirmDialog>

      {/* Clear All Tasks Confirmation */}
      <ConfirmDialog
        open={showClearAll}
        onOpenChange={setShowClearAll}
        title="Clear All To-Dos"
        confirmLabel="Clear All"
        onConfirm={handleClearAllTasks}
      >
        Delete all to-dos? This cannot be undone.
      </ConfirmDialog>

      {/* Custom Snooze Dialog */}
      <Dialog
        open={!!customSnoozeTask}
        onOpenChange={(open) => {
          if (!open) setCustomSnoozeTask(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Snooze until…</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Hide{" "}
              <strong className="text-foreground/80">
                &quot;{customSnoozeTask?.title}&quot;
              </strong>{" "}
              from the open list until this moment.
            </p>
            <input
              type="datetime-local"
              value={customSnoozeValue}
              onChange={(e) => setCustomSnoozeValue(e.target.value)}
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCustomSnoozeTask(null)}
              disabled={snoozeTaskMut.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCustomSnoozeSave}
              disabled={snoozeTaskMut.isPending || !customSnoozeValue}
            >
              {snoozeTaskMut.isPending ? "Snoozing..." : "Snooze"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({
  task,
  goalName,
  onToggle,
  onEdit,
  onDelete,
  onQuickSnooze,
  onCustomSnooze,
  onUnsnooze,
}: {
  task: Task;
  goalName?: string;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onQuickSnooze: (task: Task, target: Date) => void;
  onCustomSnooze: (task: Task) => void;
  onUnsnooze: (task: Task) => void;
}) {
  const isDone = task.status === "done";
  const snoozed = isSnoozedActive(task.snoozed_until);

  return (
    <div className={`group flex items-center gap-3 rounded-lg border border-border/40 bg-card/50 px-4 py-3 transition-colors hover:bg-accent/50 ${snoozed ? "opacity-70" : ""}`}>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => onToggle(task)}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        {isDone ? (
          <CheckCircle2Icon className="size-5 text-green-500" />
        ) : (
          <CircleIcon className="size-5" />
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm leading-tight ${isDone ? "text-muted-foreground line-through" : "text-foreground/90"}`}
          >
            {task.title}
          </span>
          <Badge
            variant="secondary"
            className={`shrink-0 text-[10px] ${priorityStyles[task.priority] ?? ""}`}
          >
            {task.priority}
          </Badge>
        </div>
        {task.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {task.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {isDone && task.completed_at ? (
            <span className="flex items-center gap-1 text-[11px] text-green-500/70">
              <CheckCircle2Icon className="size-3" />
              Completed {formatDate(task.completed_at )}
            </span>
          ) : (
            task.due_date && (
              <span
                className={`flex items-center gap-1 text-[11px] ${isOverdue(task.due_date) ? "text-red-400" : "text-muted-foreground"}`}
              >
                <CalendarIcon className="size-3" />
                {formatDate(task.due_date )}
              </span>
            )
          )}
          {snoozed && task.snoozed_until && (
            <span className="flex items-center gap-1 text-[11px] text-amber-400">
              <ClockIcon className="size-3" />
              Snoozed until {formatDate(task.snoozed_until)}
            </span>
          )}
          {goalName && (
            <Badge
              variant="secondary"
              className="text-[10px] text-muted-foreground"
            >
              <TargetIcon className="mr-1 size-3" />
              Legacy Goal: {goalName}
            </Badge>
          )}
          {taskSourceLabel(task) && (
            <Link
              to={
                task.source_type === "program"
                  ? "/watches"
                  : `/digests/${task.source_id ?? ""}`
              }
              className="no-underline"
            >
              <Badge
                variant="secondary"
                className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground"
              >
                {taskSourceLabel(task)}
              </Badge>
            </Link>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
        {!isDone && (
          snoozed ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-amber-400 hover:text-foreground"
              onClick={() => onUnsnooze(task)}
              title="Clear snooze"
            >
              <BellIcon className="size-3.5" />
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  title="Snooze"
                >
                  <ClockIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SNOOZE_QUICK_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.label}
                    onClick={() => onQuickSnooze(task, option.value())}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onCustomSnooze(task)}>
                  Pick date & time...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(task)}
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(task)}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
