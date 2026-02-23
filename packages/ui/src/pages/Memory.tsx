import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import BeliefCard from "../components/BeliefCard";
import { getBeliefs, searchMemory, forgetBelief, remember, clearAllMemory } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { InfoBubble } from "../components/InfoBubble";
import { Trash2Icon, HelpCircleIcon } from "lucide-react";
import type { Belief, BeliefType } from "../types";

const TYPES: BeliefType[] = ["factual", "preference", "procedural", "architectural", "insight", "meta"];

const typeColorMap: Record<string, string> = {
  factual: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  preference: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  procedural: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  architectural: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  insight: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  meta: "bg-pink-500/15 text-pink-400 border-pink-500/30",
};

const typeDescriptions: Record<string, string> = {
  factual: "Objective facts about you, your projects, or your environment. e.g. 'Uses TypeScript with strict mode'",
  preference: "Personal preferences and choices. e.g. 'Prefers Vitest over Jest for testing'",
  procedural: "Step-by-step processes and workflows. e.g. 'Deploy by running pnpm build then docker push'",
  architectural: "System design decisions and patterns. e.g. 'API uses Fastify with Zod validation'",
  insight: "Learned patterns and observations. e.g. 'Smaller PRs get reviewed faster in this team'",
  meta: "Beliefs about the memory system itself. e.g. 'Related beliefs about testing were synthesized'",
};

/** Parse SQLite datetime strings (e.g. "2026-02-18 20:53:32") into displayable dates */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(" ", "T"));
  return isNaN(d.getTime()) ? dateStr : d.toLocaleString();
}

export default function Memory() {
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [selectedBelief, setSelectedBelief] = useState<Belief | null>(null);
  const [rememberText, setRememberText] = useState("");
  const [isRemembering, setIsRemembering] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => { document.title = "Memory Explorer - pai"; }, []);

  // Debounce search input → searchQuery
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  const fetchBeliefs = useCallback(async () => {
    setLoading(true);
    try {
      let results: Belief[];
      if (searchQuery.trim()) {
        results = await searchMemory(searchQuery);
        // Apply status/type filters to search results client-side
        if (filterStatus && filterStatus !== "all") {
          results = results.filter((b) => b.status === filterStatus);
        }
        if (filterType) {
          results = results.filter((b) => b.type === filterType);
        }
      } else {
        results = await getBeliefs({
          status: filterStatus,
          type: filterType || undefined,
        });
      }
      setBeliefs(results);
    } catch {
      setBeliefs([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterType, filterStatus]);

  useEffect(() => {
    fetchBeliefs();
  }, [fetchBeliefs]);

  const handleForget = useCallback(
    async (id: string) => {
      try {
        await forgetBelief(id);
        toast.success("Belief forgotten");
        await fetchBeliefs();
        if (selectedBelief?.id === id) setSelectedBelief(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to forget belief");
      }
    },
    [fetchBeliefs, selectedBelief],
  );

  const handleRemember = useCallback(async () => {
    const text = rememberText.trim();
    if (!text) return;
    setIsRemembering(true);
    try {
      await remember(text);
      setRememberText("");
      toast.success("Memory stored");
      await fetchBeliefs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remember");
    } finally {
      setIsRemembering(false);
    }
  }, [rememberText, fetchBeliefs]);

  const handleClearAll = useCallback(async () => {
    setIsClearing(true);
    try {
      await clearAllMemory();
      setShowClearConfirm(false);
      setSelectedBelief(null);
      toast.success("All memory cleared");
      await fetchBeliefs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear memory");
    } finally {
      setIsClearing(false);
    }
  }, [fetchBeliefs]);

  const handleStatusChange = (value: string) => {
    setFilterStatus(value);
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="space-y-4 border-b border-border/40 bg-[#0a0a0a] px-4 py-4 md:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-sm font-semibold text-foreground">
                Memory Explorer
                <InfoBubble text="Beliefs are facts, preferences, and insights that pai has learned. They have confidence scores that change over time as evidence reinforces or contradicts them." />
              </h1>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {beliefs.length} belief{beliefs.length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
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

          {/* Search */}
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Semantic search across beliefs..."
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
          />

          {/* Status tabs */}
          <Tabs defaultValue="active" onValueChange={handleStatusChange}>
            <TabsList className="h-8">
              <TabsTrigger value="active" className="text-xs">Active</TabsTrigger>
              <TabsTrigger value="forgotten" className="text-xs">Forgotten</TabsTrigger>
              <TabsTrigger value="invalidated" className="text-xs">Invalidated</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Type filter badges with tooltips */}
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
        </header>

        {/* Remember input */}
        <div className="border-b border-border/40 bg-[#0a0a0a] px-4 py-3 md:px-6">
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

        {/* Belief grid */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">
            {loading ? (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-4">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-4 w-10" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-1 w-full" />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : beliefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-30">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                {searchInput ? "No beliefs match your search." : "No beliefs found. Start remembering."}
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

      {/* Detail sidebar backdrop (mobile) */}
      {selectedBelief && (
        <div
          className="fixed inset-0 z-[51] bg-black/60 md:hidden"
          onClick={() => setSelectedBelief(null)}
        />
      )}

      {/* Detail sidebar */}
      {selectedBelief && (
        <aside className="fixed inset-y-0 right-0 z-[52] w-[85vw] max-w-80 overflow-hidden border-l border-border/40 bg-[#0a0a0a] md:relative md:z-auto md:w-80 md:max-w-none">
          <ScrollArea className="h-full">
            <div className="p-5">
              <Card className="gap-4 border-border/50 bg-card/30 py-4">
                <CardHeader className="flex-row items-center justify-between px-4 py-0">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Belief Detail
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setSelectedBelief(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </Button>
                </CardHeader>

                <CardContent className="space-y-4 px-4 py-0">
                  {/* Type badge with description */}
                  <div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-md text-[10px] font-medium uppercase tracking-wider",
                        typeColorMap[selectedBelief.type] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {selectedBelief.type}
                    </Badge>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
                      {typeDescriptions[selectedBelief.type]}
                    </p>
                  </div>

                  {/* Statement */}
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {selectedBelief.statement}
                  </p>

                  <Separator className="opacity-30" />

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <DetailMetric label="Confidence" value={`${Math.round(selectedBelief.confidence * 100)}%`} info="How certain pai is about this belief. Increases when reinforced, decreases when contradicted." />
                    <DetailMetric label="Stability" value={selectedBelief.stability.toFixed(1)} info="Resistance to decay (1.0–5.0). Frequently accessed beliefs become more stable over time." />
                    <DetailMetric label="Importance" value={selectedBelief.importance.toFixed(2)} info="How significant this belief is for retrieval ranking. Higher importance beliefs surface first in search." />
                    <DetailMetric label="Access Count" value={String(selectedBelief.access_count)} info="Number of times this belief has been recalled or referenced in conversations." />
                  </div>

                  <Separator className="opacity-30" />

                  {/* Status */}
                  <div>
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Status
                    </span>
                    <Badge variant={selectedBelief.status === "active" ? "secondary" : "destructive"} className="text-[10px]">
                      {selectedBelief.status}
                    </Badge>
                  </div>

                  {/* Dates */}
                  <div className="space-y-2">
                    <DetailRow label="Created" value={formatDate(selectedBelief.created_at)} />
                    <DetailRow label="Updated" value={formatDate(selectedBelief.updated_at)} />
                    <DetailRow label="ID" value={selectedBelief.id} mono />
                  </div>

                  {/* Forget action */}
                  {selectedBelief.status === "active" && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => handleForget(selectedBelief.id)}
                    >
                      Forget this belief
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </aside>
      )}

      {/* Memory System Explainer Dialog */}
      <Dialog open={showExplainer} onOpenChange={setShowExplainer}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">How Memory Works</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            {/* Visual lifecycle */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 overflow-x-auto">
              <pre className="font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre">{"Observation        LLM extracts beliefs\n─────────── ────► ┌──────────────────┐\n\"User said X\"      │  Belief created  │\n                   │  confidence: 0.7 │\n                   └────────┬─────────┘\n                            │\n           ┌────────────────┼───────────────┐\n           ▼                ▼               ▼\n     ┌──────────┐   ┌─────────────┐  ┌─────────────┐\n     │Reinforced│   │Contradicted │  │ Decays over │\n     │conf ↑    │   │conf ↓       │  │ time if not │\n     │stable ↑  │   │may become   │  │ accessed    │\n     └──────────┘   │invalidated  │  └─────────────┘\n                    └─────────────┘"}</pre>
            </div>

            {/* Type explanations */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Belief Types</h3>
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

            {/* Key concepts */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key Metrics</h3>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p><strong className="text-foreground/80">Confidence</strong> — How certain pai is (0–100%). Reinforced beliefs gain confidence, contradicted ones lose it.</p>
                <p><strong className="text-foreground/80">Stability</strong> — Resistance to decay (1.0–5.0). Frequently accessed beliefs become more stable.</p>
                <p><strong className="text-foreground/80">Importance</strong> — Retrieval priority. Higher importance beliefs surface first in search.</p>
              </div>
            </div>

            {/* Status lifecycle */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statuses</h3>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p><Badge variant="secondary" className="mr-1 text-[9px]">active</Badge> Currently used for recall and context.</p>
                <p><Badge variant="destructive" className="mr-1 text-[9px]">forgotten</Badge> Soft-deleted by user. Preserved in history but not used.</p>
                <p><Badge variant="destructive" className="mr-1 text-[9px]">invalidated</Badge> Contradicted by newer evidence. Superseded by a different belief.</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear All Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Clear All Memory</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will forget all active beliefs. They will be marked as &quot;forgotten&quot; and won&apos;t be used for recall, but they are preserved in history.
            </p>
            <p className="text-sm font-medium text-destructive">
              This action cannot be easily undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowClearConfirm(false)} disabled={isClearing}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleClearAll} disabled={isClearing}>
                {isClearing ? "Clearing..." : "Clear all memory"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
