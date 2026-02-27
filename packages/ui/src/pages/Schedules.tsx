import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { Schedule } from "../api";
import { useSchedules, useCreateSchedule, useDeleteSchedule, usePauseSchedule, useResumeSchedule } from "@/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  PauseIcon,
  PlayIcon,
  ClockIcon,
  CalendarClockIcon,
} from "lucide-react";

function formatInterval(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  return `${days}d`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "due now";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `in ${Math.round(hours / 24)}d`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

export default function Schedules() {
  const { data: schedules = [], isLoading: loading } = useSchedules();

  // Add/Edit dialog state (UI-only)
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [form, setForm] = useState({ label: "", goal: "", intervalHours: "24", startAt: "" });

  // Delete confirmation (UI-only)
  const [deleting, setDeleting] = useState<Schedule | null>(null);

  const createSchedule = useCreateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const pauseSchedule = usePauseSchedule();
  const resumeSchedule = useResumeSchedule();

  useEffect(() => {
    document.title = "Schedules - pai";
  }, []);

  const saving = createSchedule.isPending || deleteSchedule.isPending;

  const openAdd = () => {
    setEditing(null);
    setForm({ label: "", goal: "", intervalHours: "24", startAt: "" });
    setShowDialog(true);
  };

  const openEdit = (s: Schedule) => {
    setEditing(s);
    setForm({
      label: s.label,
      goal: s.goal,
      intervalHours: String(s.intervalHours),
      startAt: "",
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.label.trim() || !form.goal.trim()) return;
    const payload = {
      label: form.label.trim(),
      goal: form.goal.trim(),
      intervalHours: parseInt(form.intervalHours) || 24,
      ...(form.startAt ? { startAt: new Date(form.startAt).toISOString() } : {}),
    };
    try {
      if (editing) {
        // Delete old + create new (no update endpoint)
        await deleteSchedule.mutateAsync(editing.id);
        await createSchedule.mutateAsync(payload);
        toast.success("Schedule updated");
      } else {
        await createSchedule.mutateAsync(payload);
        toast.success("Schedule created");
      }
      setShowDialog(false);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save schedule");
    }
  };

  const handleDelete = async (s: Schedule) => {
    try {
      await deleteSchedule.mutateAsync(s.id);
      toast.success("Schedule deleted");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const handleTogglePause = async (s: Schedule) => {
    try {
      if (s.status === "active") {
        await pauseSchedule.mutateAsync(s.id);
        toast.success("Schedule paused");
      } else {
        await resumeSchedule.mutateAsync(s.id);
        toast.success("Schedule resumed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update schedule");
    }
  };

  const activeCount = schedules.filter((s) => s.status === "active").length;
  const pausedCount = schedules.filter((s) => s.status === "paused").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <CalendarClockIcon className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Schedules</h1>
          {!loading && (
            <span className="text-sm text-muted-foreground">
              {activeCount} active{pausedCount > 0 ? `, ${pausedCount} paused` : ""}
            </span>
          )}
        </div>
        <Button size="sm" onClick={openAdd}>
          <PlusIcon className="mr-1 size-4" />
          New Schedule
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-4">
                <Skeleton className="size-5 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
            <CalendarClockIcon className="size-10 opacity-40" />
            <p className="text-lg font-medium">No scheduled research</p>
            <p className="max-w-sm text-sm">
              Create a schedule to run research automatically at regular intervals.
              Ask the assistant to "schedule daily research on AI news" or create one here.
            </p>
            <Button size="sm" variant="outline" onClick={openAdd} className="mt-2">
              <PlusIcon className="mr-1 size-4" />
              Create Schedule
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                onEdit={openEdit}
                onDelete={setDeleting}
                onTogglePause={handleTogglePause}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) { setShowDialog(false); setEditing(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Schedule" : "New Schedule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Label</label>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="AI news daily"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Research Goal</label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Research the latest AI news and developments. Find recent breakthroughs, major announcements, new model releases..."
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Interval</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.intervalHours}
                onChange={(e) => setForm({ ...form, intervalHours: e.target.value })}
              >
                <option value="6">Every 6 hours</option>
                <option value="12">Every 12 hours</option>
                <option value="24">Daily (every 24 hours)</option>
                <option value="48">Every 2 days</option>
                <option value="168">Weekly</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">First Run At <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input
                type="datetime-local"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave empty to start after the first interval. Set a time to schedule the first run at a specific date and time.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowDialog(false); setEditing(null); }}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.label.trim() || !form.goal.trim()}>
              {saving ? "Saving..." : editing ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Schedule</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            Delete "{deleting?.label}"? This will stop all future runs. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && handleDelete(deleting)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScheduleRow({
  schedule: s,
  onEdit,
  onDelete,
  onTogglePause,
}: {
  schedule: Schedule;
  onEdit: (s: Schedule) => void;
  onDelete: (s: Schedule) => void;
  onTogglePause: (s: Schedule) => void;
}) {
  const isPaused = s.status === "paused";

  return (
    <div className={`group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 ${isPaused ? "opacity-60" : ""}`}>
      <div className="mt-0.5">
        <ClockIcon className={`size-5 ${isPaused ? "text-muted-foreground" : "text-blue-500"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{s.label}</span>
          <Badge variant={isPaused ? "secondary" : "outline"} className="text-xs">
            {formatInterval(s.intervalHours)}
          </Badge>
          {isPaused && (
            <Badge variant="secondary" className="text-xs">Paused</Badge>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.goal}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {!isPaused && (
            <span>Next: {formatDateTime(s.nextRunAt)} ({timeUntil(s.nextRunAt)})</span>
          )}
          {s.lastRunAt && (
            <span>Last: {formatDateTime(s.lastRunAt)}</span>
          )}
          <span className="font-mono text-[10px] opacity-50">{s.id}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => onTogglePause(s)} title={isPaused ? "Resume" : "Pause"}>
          {isPaused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => onEdit(s)} title="Edit">
          <PencilIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => onDelete(s)} title="Delete">
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
