import { useState, useEffect, useRef, useMemo } from "react";
import { NavLink } from "react-router-dom";
import { toast } from "sonner";
import BeliefCard from "../components/BeliefCard";
import {
  useBeliefs,
  useSearchMemory,
  useForgetBelief,
  useRemember,
  useClearAllMemory,
  useUpdateBelief,
} from "@/hooks";
import { useProfile } from "@/hooks/use-library";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { typeColorMap } from "@/lib/belief-colors";
import { QueryError } from "@/components/QueryError";
import { InfoBubble } from "../components/InfoBubble";
import { FirstVisitBanner } from "../components/FirstVisitBanner";
import { Trash2Icon, HelpCircleIcon, PencilIcon, CheckIcon, XIcon } from "lucide-react";
import type { Belief, BeliefType } from "../types";
import { formatDate, parseApiDate } from "@/lib/datetime";

const TYPES: BeliefType[] = ["factual", "preference", "procedural", "architectural", "insight", "meta"];

const typeDescriptions: Record<string, string> = {
  factual: "Objective facts about you, your projects, or your environment. e.g. 'Uses TypeScript with strict mode'",
  preference: "Personal preferences and choices. e.g. 'Prefers Vitest over Jest for testing'",
  procedural: "Step-by-step processes and workflows. e.g. 'Deploy by running pnpm build then docker push'",
  architectural: "System design decisions and patterns. e.g. 'API uses Fastify with Zod validation'",
  insight: "Learned patterns and observations. e.g. 'Smaller PRs get reviewed faster in this team'",
  meta: "Memories about the memory system itself. e.g. 'Related memories about testing were synthesized'",
};

function sortBeliefs(results: Belief[], sortBy: string): Belief[] {
  return [...results].sort((a, b) => {
    switch (sortBy) {
      case "recent":
        return parseApiDate(b.updated_at).getTime() - parseApiDate(a.updated_at).getTime();
      case "importance":
        return b.importance - a.importance;
      case "created":
        return parseApiDate(b.created_at).getTime() - parseApiDate(a.created_at).getTime();
      default:
        return b.confidence - a.confidence;
    }
  });
}

export default function Memory() {
  const isMobile = useIsMobile();

  // --- Debounced search state ---
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // --- Filter / sort state ---
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [filterSubject, setFilterSubject] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("confidence");

  // --- UI state ---
  const [selectedBelief, setSelectedBelief] = useState<Belief | null>(null);
  const [rememberText, setRememberText] = useState("");
  const [showExplainer, setShowExplainer] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [editingStatement, setEditingStatement] = useState<string | null>(null);

  // --- TanStack Query hooks ---
  const isSearchMode = searchQuery.trim().length > 0;

  const beliefsParams = useMemo(
    () => ({ status: filterStatus, type: filterType || undefined }),
    [filterStatus, filterType],
  );
  const { data: rawBeliefs = [], isLoading: beliefsLoading, isError: beliefsError, refetch: beliefsRefetch } = useBeliefs(beliefsParams);
  const { data: rawSearchResults = [], isLoading: searchLoading } = useSearchMemory(searchQuery);

  // --- Mutations ---
  const forgetMutation = useForgetBelief();
  const rememberMutation = useRemember();
  const clearAllMutation = useClearAllMemory();
  const updateBeliefMutation = useUpdateBelief();

  useEffect(() => { document.title = "Memories - pai"; }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // Derive the final beliefs list from query data + client-side filters/sort
  const beliefs = useMemo(() => {
    let results: Belief[];
    if (isSearchMode) {
      results = [...rawSearchResults];
      // Apply filters that the search API doesn't handle
      if (filterStatus && filterStatus !== "all") {
        results = results.filter((b) => b.status === filterStatus);
      }
      if (filterType) {
        results = results.filter((b) => b.type === filterType);
      }
    } else {
      results = [...rawBeliefs];
    }
    if (filterSubject) {
      results = results.filter((b) => b.subject === filterSubject);
    }
    return sortBeliefs(results, sortBy);
  }, [rawBeliefs, rawSearchResults, isSearchMode, filterStatus, filterType, filterSubject, sortBy]);

  const loading = isSearchMode ? searchLoading : beliefsLoading;

  const subjects = useMemo(() => {
    const unique = [...new Set(beliefs.map((b) => b.subject).filter(Boolean))] as string[];
    return unique.length >= 2 ? unique : [];
  }, [beliefs]);

  const stats = useMemo(() => {
    if (beliefs.length === 0) return null;
    const avgConfidence = beliefs.reduce((s, b) => s + b.confidence, 0) / beliefs.length;
    const typeCounts = beliefs.reduce((acc, b) => {
      acc[b.type] = (acc[b.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topTypes = Object.entries(typeCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    return { avgConfidence, topTypes };
  }, [beliefs]);

  const handleForget = async (id: string) => {
    try {
      await forgetMutation.mutateAsync(id);
      toast.success("Memory forgotten");
      if (selectedBelief?.id === id) setSelectedBelief(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to forget memory");
    }
  };

  const handleRemember = async () => {
    const text = rememberText.trim();
    if (!text) return;
    try {
      await rememberMutation.mutateAsync(text);
      setRememberText("");
      toast.success("Memory stored");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remember");
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAllMutation.mutateAsync();
      setShowClearConfirm(false);
      setSelectedBelief(null);
      toast.success("All memory cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear memory");
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedBelief || editingStatement === null) return;
    const trimmed = editingStatement.trim();
    if (!trimmed || trimmed === selectedBelief.statement) {
      setEditingStatement(null);
      return;
    }
    try {
      const updated = await updateBeliefMutation.mutateAsync({ id: selectedBelief.id, statement: trimmed });
      setSelectedBelief(updated);
      setEditingStatement(null);
      toast.success("Memory updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update memory");
    }
  };

  const handleStatusChange = (value: string) => {
    setFilterStatus(value);
  };

  const { data: profile } = useProfile();

  const isRemembering = rememberMutation.isPending;
  const isClearing = clearAllMutation.isPending;
  const isSavingEdit = updateBeliefMutation.isPending;

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Library navigation tabs */}
        <nav className="flex items-center gap-1 border-b border-border/30 px-3 md:px-6">
          {[
            { to: "/library", label: "Memories" },
            { to: "/library/documents", label: "Documents" },
          ].map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === "/library"}
              className={({ isActive }) =>
                `px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <FirstVisitBanner pageKey="memory" tip="Everything I know about you — built automatically from our conversations. Memories evolve as you share more." />
        <header className="space-y-2 border-b border-border/40 bg-background px-3 py-3 md:space-y-4 md:px-6 md:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="shrink-0 text-sm font-semibold text-foreground">
                Memories
                <InfoBubble text="Memories are facts, preferences, and insights that pai has learned. They have confidence scores that change over time as evidence reinforces or contradicts them." />
              </h1>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {beliefs.length} memor{beliefs.length !== 1 ? "ies" : "y"}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={() => setShowExplainer(true)}>
                    <HelpCircleIcon className="size-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>How memory works</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={() => setShowClearConfirm(true)} className="text-muted-foreground hover:text-destructive">
                    <Trash2Icon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear all memory</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {!loading && !searchQuery && stats && (
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Avg conf: {Math.round(stats.avgConfidence * 100)}%
              </Badge>
              {stats.topTypes.map(([type, count]) => (
                <Badge key={type} variant="outline" className={cn("text-[10px]", typeColorMap[type])}>
                  {type}: {count}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Semantic search across memories..."
              className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
            />
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="rounded-md border border-border/50 bg-background px-2 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              >
                <option value="confidence">Confidence</option>
                <option value="recent">Recent</option>
                <option value="importance">Importance</option>
                <option value="created">Created</option>
              </select>
            </div>
          </div>

          <Tabs defaultValue="active" onValueChange={handleStatusChange}>
            <TabsList className="h-8">
              <TabsTrigger value="active" className="text-xs">Active</TabsTrigger>
              <TabsTrigger value="forgotten" className="text-xs">Forgotten</TabsTrigger>
              <TabsTrigger value="invalidated" className="text-xs">Invalidated</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant={filterType === "" ? "default" : "ghost"}
              className="cursor-pointer text-[10px]"
              onClick={() => setFilterType("")}
            >
              All types
            </Badge>
            {TYPES.map((t) => (
              <Tooltip key={t}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="ghost"
                    className={cn(
                      "cursor-pointer border text-[10px] capitalize transition-colors",
                      filterType === t
                        ? typeColorMap[t]
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setFilterType(filterType === t ? "" : t)}
                  >
                    {t}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-64 text-xs">
                  {typeDescriptions[t]}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          {subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <Badge
                variant={filterSubject === "" ? "default" : "ghost"}
                className="cursor-pointer text-[10px]"
                onClick={() => setFilterSubject("")}
              >
                All subjects
              </Badge>
              {subjects.map((s) => (
                <Badge
                  key={s}
                  variant="ghost"
                  className={cn(
                    "cursor-pointer border text-[10px] capitalize transition-colors",
                    filterSubject === s
                      ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setFilterSubject(filterSubject === s ? "" : s)}
                >
                  {s}
                </Badge>
              ))}
            </div>
          )}
        </header>

        {profile?.summary && (
          <div className="border-b border-border/20 bg-card/30 px-3 py-3 md:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Profile</h3>
                <div className="space-y-1 text-sm text-foreground/80">
                  {profile.summary.split("\n").map((line, i) => {
                    const match = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
                    if (!match) return null;
                    return (
                      <p key={i}>
                        <span className="font-medium text-foreground/60">{match[1]}: </span>
                        <span>{match[2]}</span>
                      </p>
                    );
                  })}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground/40">
                {profile.coreBeliefs} core · {profile.totalBeliefs} total
              </span>
            </div>
          </div>
        )}

        <div className="border-b border-border/40 bg-background px-4 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={rememberText}
              onChange={(e) => setRememberText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRemember();
              }}
              placeholder="Remember something new..."
              className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              disabled={isRemembering}
            />
            <Button
              onClick={handleRemember}
              disabled={isRemembering || !rememberText.trim()}
              size="sm"
            >
              {isRemembering ? "..." : "Remember"}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">
            {loading ? (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-3 border-l-2 border-l-border/30 rounded-r-lg bg-card/30 px-4 py-3.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-4 w-10" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-0.5 w-full" />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : beliefsError ? (
              <QueryError message="Failed to load memories." onRetry={beliefsRefetch} />
            ) : beliefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-30">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                {searchInput ? (
                  "No memories match your search."
                ) : (
                  <div className="text-center">
                    <p>No memories yet.</p>
                    <p className="mt-1 text-xs">Start chatting to build your memory, or type something above to remember.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {beliefs.map((b) => (
                  <BeliefCard
                    key={b.id}
                    belief={b}
                    onForget={handleForget}
                    onClick={setSelectedBelief}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedBelief && (isMobile ? (
        <Sheet open={!!selectedBelief} onOpenChange={(open) => { if (!open) { setSelectedBelief(null); setEditingStatement(null); } }}>
          <SheetContent side="right" showCloseButton={false} className="w-[85vw] max-w-80 gap-0 overflow-y-auto p-0">
            <SheetTitle className="sr-only">Memory Detail</SheetTitle>
            <BeliefDetailPanel belief={selectedBelief} onClose={() => { setSelectedBelief(null); setEditingStatement(null); }} editingStatement={editingStatement} setEditingStatement={setEditingStatement} handleSaveEdit={handleSaveEdit} isSavingEdit={isSavingEdit} handleForget={handleForget} />
          </SheetContent>
        </Sheet>
      ) : (
        <aside className="relative z-auto w-80 overflow-hidden border-l border-border/40 bg-background">
          <BeliefDetailPanel belief={selectedBelief} onClose={() => { setSelectedBelief(null); setEditingStatement(null); }} editingStatement={editingStatement} setEditingStatement={setEditingStatement} handleSaveEdit={handleSaveEdit} isSavingEdit={isSavingEdit} handleForget={handleForget} />
        </aside>
      ))}

      <Dialog open={showExplainer} onOpenChange={setShowExplainer}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">How Memories Work</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 overflow-x-auto">
              <pre className="font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre">{"Observation        LLM extracts memories\n─────────── ────► ┌──────────────────┐\n\"User said X\"      │  Memory created  │\n                   │  confidence: 0.7 │\n                   └────────┬─────────┘\n                            │\n           ┌────────────────┼───────────────┐\n           ▼                ▼               ▼\n     ┌──────────┐   ┌─────────────┐  ┌─────────────┐\n     │Reinforced│   │Contradicted │  │ Decays over │\n     │conf ↑    │   │conf ↓       │  │ time if not │\n     │stable ↑  │   │may become   │  │ accessed    │\n     └──────────┘   │invalidated  │  └─────────────┘\n                    └─────────────┘"}</pre>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Memory Types</h3>
              <div className="space-y-2">
                {TYPES.map((t) => (
                  <div key={t} className="flex gap-2">
                    <Badge variant="outline" className={cn("mt-0.5 shrink-0 text-[9px]", typeColorMap[t])}>
                      {t}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{typeDescriptions[t]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key Metrics</h3>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p><strong className="text-foreground/80">Confidence</strong> — How certain pai is (0-100%). Reinforced memories gain confidence, contradicted ones lose it.</p>
                <p><strong className="text-foreground/80">Stability</strong> — Resistance to decay (1.0-5.0). Frequently accessed memories become more stable.</p>
                <p><strong className="text-foreground/80">Importance</strong> — Retrieval priority. Higher importance memories surface first in search.</p>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statuses</h3>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p><Badge variant="secondary" className="mr-1 text-[9px]">active</Badge> Currently used for recall and context.</p>
                <p><Badge variant="destructive" className="mr-1 text-[9px]">forgotten</Badge> Soft-deleted by user. Preserved in history but not used.</p>
                <p><Badge variant="destructive" className="mr-1 text-[9px]">invalidated</Badge> Contradicted by newer evidence. Superseded by a different memory.</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear All Memory"
        confirmLabel={isClearing ? "Clearing..." : "Clear all memory"}
        onConfirm={handleClearAll}
      >
        <p>
          This will forget all active memories. They will be marked as &quot;forgotten&quot; and won&apos;t be used for recall, but they are preserved in history.
        </p>
        <p className="font-medium text-destructive">
          This action cannot be easily undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function DetailMetric({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div>
      <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {info && <InfoBubble text={info} side="right" />}
      </span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm text-foreground/70", mono && "font-mono text-xs text-muted-foreground")}>
        {value}
      </span>
    </div>
  );
}

function BeliefDetailPanel({
  belief,
  onClose,
  editingStatement,
  setEditingStatement,
  handleSaveEdit,
  isSavingEdit,
  handleForget,
}: {
  belief: Belief;
  onClose: () => void;
  editingStatement: string | null;
  setEditingStatement: (v: string | null) => void;
  handleSaveEdit: () => void;
  isSavingEdit: boolean;
  handleForget: (id: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5">
        <Card className="gap-4 border-border/50 bg-card/30 py-4">
          <CardHeader className="flex-row items-center justify-between px-4 py-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Memory Detail
              </CardTitle>
              {editingStatement === null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setEditingStatement(belief.statement)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <PencilIcon className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit statement</TooltipContent>
                </Tooltip>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Button>
          </CardHeader>

          <CardContent className="space-y-4 px-4 py-0">
            <div>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-md text-[10px] font-medium uppercase tracking-wider",
                  typeColorMap[belief.type] ?? "bg-muted text-muted-foreground",
                )}
              >
                {belief.type}
              </Badge>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
                {typeDescriptions[belief.type]}
              </p>
            </div>

            {editingStatement !== null ? (
              <div className="space-y-2">
                <textarea
                  value={editingStatement}
                  onChange={(e) => setEditingStatement(e.target.value)}
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                  rows={4}
                  disabled={isSavingEdit}
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={isSavingEdit || !editingStatement.trim()}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <CheckIcon className="size-3" />
                    {isSavingEdit ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingStatement(null)}
                    disabled={isSavingEdit}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <XIcon className="size-3" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-foreground/90">
                {belief.statement}
              </p>
            )}

            <Separator className="opacity-30" />

            <div className="grid grid-cols-2 gap-3">
              <DetailMetric label="Confidence" value={`${Math.round(belief.confidence * 100)}%`} info="How certain pai is about this memory. Increases when reinforced, decreases when contradicted." />
              <DetailMetric label="Stability" value={belief.stability.toFixed(1)} info="Resistance to decay (1.0-5.0). Frequently accessed memories become more stable over time." />
              <DetailMetric label="Importance" value={belief.importance.toFixed(2)} info="How significant this memory is for retrieval ranking. Higher importance memories surface first in search." />
              <DetailMetric label="Access Count" value={String(belief.access_count)} info="Number of times this memory has been recalled or referenced in conversations." />
            </div>

            <Separator className="opacity-30" />

            <div>
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </span>
              <Badge variant={belief.status === "active" ? "secondary" : "destructive"} className="text-[10px]">
                {belief.status}
              </Badge>
            </div>

            {belief.subject && (
              <div>
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Subject
                </span>
                <span className="text-sm capitalize text-foreground/70">{belief.subject}</span>
              </div>
            )}

            <div className="space-y-2">
              <DetailRow label="Created" value={formatDate(belief.created_at )} />
              <DetailRow label="Updated" value={formatDate(belief.updated_at )} />
              <DetailRow label="ID" value={belief.id} mono />
            </div>

            {belief.status === "active" && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => handleForget(belief.id)}
              >
                Forget this memory
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
