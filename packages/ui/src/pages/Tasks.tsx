import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  getTasks,
  createTask,
  updateTask,
  completeTask,
  reopenTask,
  deleteTask,
  clearAllTasks,
  getGoals,
  createGoal,
  completeGoal,
  deleteGoal,
} from "../api";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusIcon,
  Trash2Icon,
  PencilIcon,
  CheckCircle2Icon,
  CircleIcon,
  TargetIcon,
  CalendarIcon,
} from "lucide-react";
import type { Task, Goal } from "../types";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(" ", "T"));
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
}

function isOverdue(dueDateStr: string): boolean {
  const due = new Date(dueDateStr.replace(" ", "T"));
  if (isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

const priorityStyles: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-yellow-500/15 text-yellow-400",
  low: "bg-muted text-muted-foreground",
};

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"tasks" | "goals">("tasks");
  const [statusFilter, setStatusFilter] = useState<string>("open");

  // Task dialogs
  const [showAddTask, setShowAddTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    dueDate: "",
    goalId: "",
  });
  const [isSavingTask, setIsSavingTask] = useState(false);

  // Goal dialogs
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: "", description: "" });
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  // Delete confirmations
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const [showClearAll, setShowClearAll] = useState(false);

  useEffect(() => {
    document.title = "Tasks - pai";
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await getTasks({ status: statusFilter });
      setTasks(data);
    } catch {
      setTasks([]);
    }
  }, [statusFilter]);

  const fetchAllTasks = useCallback(async () => {
    try {
      const data = await getTasks({ status: "all" });
      setAllTasks(data);
    } catch {
      setAllTasks([]);
    }
  }, []);

  const fetchGoals = useCallback(async () => {
    try {
      const data = await getGoals();
      setGoals(data);
    } catch {
      setGoals([]);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTasks(), fetchAllTasks(), fetchGoals()]).finally(() =>
      setLoading(false),
    );
  }, [fetchTasks, fetchAllTasks, fetchGoals]);

  // --- Task handlers ---

  const handleToggleTask = useCallback(
    async (task: Task) => {
      try {
        if (task.status === "open") {
          await completeTask(task.id);
          toast.success("Task completed");
        } else {
          await reopenTask(task.id);
          toast.success("Task reopened");
        }
        await Promise.all([fetchTasks(), fetchAllTasks()]);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update task",
        );
      }
    },
    [fetchTasks, fetchAllTasks],
  );

  const handleDeleteTask = useCallback(
    async (task: Task) => {
      try {
        await deleteTask(task.id);
        toast.success("Task deleted");
        setDeletingTask(null);
        await Promise.all([fetchTasks(), fetchAllTasks()]);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete task",
        );
      }
    },
    [fetchTasks, fetchAllTasks],
  );

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

  const handleSaveTask = useCallback(async () => {
    const title = taskForm.title.trim();
    if (!title) return;
    setIsSavingTask(true);
    try {
      if (editingTask) {
        await updateTask(editingTask.id, {
          title,
          priority: taskForm.priority,
          dueDate: taskForm.dueDate || undefined,
        });
        toast.success("Task updated");
      } else {
        await createTask({
          title,
          description: taskForm.description.trim() || undefined,
          priority: taskForm.priority,
          dueDate: taskForm.dueDate || undefined,
          goalId: taskForm.goalId || undefined,
        });
        toast.success("Task created");
      }
      setShowAddTask(false);
      setEditingTask(null);
      await Promise.all([fetchTasks(), fetchAllTasks()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setIsSavingTask(false);
    }
  }, [taskForm, editingTask, fetchTasks, fetchAllTasks]);

  // --- Goal handlers ---

  const openAddGoal = () => {
    setGoalForm({ title: "", description: "" });
    setShowAddGoal(true);
  };

  const handleSaveGoal = useCallback(async () => {
    const title = goalForm.title.trim();
    if (!title) return;
    setIsSavingGoal(true);
    try {
      await createGoal({
        title,
        description: goalForm.description.trim() || undefined,
      });
      toast.success("Goal created");
      setShowAddGoal(false);
      await fetchGoals();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create goal");
    } finally {
      setIsSavingGoal(false);
    }
  }, [goalForm, fetchGoals]);

  const handleCompleteGoal = useCallback(
    async (goal: Goal) => {
      try {
        await completeGoal(goal.id);
        toast.success("Goal completed");
        await fetchGoals();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to complete goal",
        );
      }
    },
    [fetchGoals],
  );

  const handleDeleteGoal = useCallback(
    async (goal: Goal) => {
      try {
        await deleteGoal(goal.id);
        toast.success("Goal deleted");
        setDeletingGoal(null);
        await fetchGoals();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete goal",
        );
      }
    },
    [fetchGoals],
  );

  const handleClearAllTasks = useCallback(async () => {
    try {
      const result = await clearAllTasks();
      toast.success(`Cleared ${result.cleared} task${result.cleared !== 1 ? "s" : ""}`);
      setShowClearAll(false);
      await Promise.all([fetchTasks(), fetchAllTasks()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear tasks");
    }
  }, [fetchTasks, fetchAllTasks]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top-level tabs */}
      <header className="space-y-4 border-b border-border/40 bg-[#0a0a0a] px-4 py-4 md:px-6">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "tasks" | "goals")}
        >
          <TabsList className="h-8">
            <TabsTrigger value="tasks" className="text-xs">
              Tasks
            </TabsTrigger>
            <TabsTrigger value="goals" className="text-xs">
              Goals
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Tab-specific header */}
        {activeTab === "tasks" ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="shrink-0 font-mono text-sm font-semibold text-foreground">
                  Tasks
                </h1>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {tasks.length} task{tasks.length !== 1 ? "s" : ""}
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
                <TabsTrigger value="done" className="text-xs">
                  Done
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs">
                  All
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="shrink-0 font-mono text-sm font-semibold text-foreground">
                Goals
              </h1>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {activeGoals.length} active
              </Badge>
            </div>
            <Button variant="ghost" size="icon-xs" onClick={openAddGoal}>
              <PlusIcon className="size-4 text-muted-foreground" />
            </Button>
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
          ) : activeTab === "tasks" ? (
            tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
                <CircleIcon className="mb-4 size-12 opacity-20" />
                <p>No tasks found.</p>
                <p className="mt-1 text-xs">
                  {statusFilter === "open"
                    ? 'Click the + button to add your first task, or switch to "All" to see completed tasks.'
                    : "No tasks match the current filter."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
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
                  />
                ))}
              </div>
            )
          ) : goals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
              <TargetIcon className="mb-4 size-12 opacity-20" />
              <p>No goals yet.</p>
              <p className="mt-1 text-xs">
                Create a goal to group and track related tasks.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {goals.map((goal) => {
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
                        <h3
                          className={`text-sm font-medium leading-tight ${goal.status === "done" ? "text-muted-foreground line-through" : "text-foreground/90"}`}
                        >
                          {goal.title}
                        </h3>
                        {goal.description && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {goal.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {goal.status === "active" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-green-400"
                            onClick={() => handleCompleteGoal(goal)}
                          >
                            <CheckCircle2Icon className="size-4" />
                          </Button>
                        )}
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
                      {progress.done}/{progress.total} tasks done
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
              {editingTask ? "Edit Task" : "Add Task"}
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
                placeholder="What needs to be done?"
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                autoFocus
              />
            </div>

            {!editingTask && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Description
                </label>
                <textarea
                  value={taskForm.description}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="Optional details..."
                  rows={3}
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                />
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

            {!editingTask && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Goal
                </label>
                <select
                  value={taskForm.goalId}
                  onChange={(e) =>
                    setTaskForm((f) => ({ ...f, goalId: e.target.value }))
                  }
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                >
                  <option value="">No goal</option>
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
                  : "Add Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Goal Dialog */}
      <Dialog open={showAddGoal} onOpenChange={setShowAddGoal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Title
              </label>
              <input
                type="text"
                value={goalForm.title}
                onChange={(e) =>
                  setGoalForm((f) => ({ ...f, title: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveGoal();
                }}
                placeholder="What do you want to achieve?"
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Description
              </label>
              <textarea
                value={goalForm.description}
                onChange={(e) =>
                  setGoalForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional details..."
                rows={3}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAddGoal(false)}
              disabled={isSavingGoal}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveGoal}
              disabled={isSavingGoal || !goalForm.title.trim()}
            >
              {isSavingGoal ? "Saving..." : "Add Goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Task Confirmation */}
      <Dialog
        open={!!deletingTask}
        onOpenChange={() => setDeletingTask(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete{" "}
              <strong className="text-foreground/80">
                &quot;{deletingTask?.title}&quot;
              </strong>
              ? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeletingTask(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deletingTask && handleDeleteTask(deletingTask)}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Goal Confirmation */}
      <Dialog
        open={!!deletingGoal}
        onOpenChange={() => setDeletingGoal(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete{" "}
              <strong className="text-foreground/80">
                &quot;{deletingGoal?.title}&quot;
              </strong>
              ? Tasks linked to this goal will not be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeletingGoal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deletingGoal && handleDeleteGoal(deletingGoal)}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear All Tasks Confirmation */}
      <Dialog open={showClearAll} onOpenChange={setShowClearAll}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Clear All Tasks</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete all tasks? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowClearAll(false)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleClearAllTasks}>
                Clear All
              </Button>
            </div>
          </div>
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
}: {
  task: Task;
  goalName?: string;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const isDone = task.status === "done";

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border/40 bg-card/50 px-4 py-3 transition-colors hover:bg-accent/50">
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
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {task.due_date && (
            <span
              className={`flex items-center gap-1 text-[11px] ${isDone ? "text-muted-foreground" : isOverdue(task.due_date) ? "text-red-400" : "text-muted-foreground"}`}
            >
              <CalendarIcon className="size-3" />
              {formatDate(task.due_date)}
            </span>
          )}
          {goalName && (
            <Badge
              variant="secondary"
              className="text-[10px] text-muted-foreground"
            >
              <TargetIcon className="mr-1 size-3" />
              {goalName}
            </Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
