import { useState, useEffect, useRef, useMemo } from "react";
import {
  useBeliefs,
  useKnowledgeSources,
  useLibrarySearch,
  useLibraryStats,
  useFindings,
} from "@/hooks";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SearchIcon, BrainIcon, FileTextIcon, FlaskConicalIcon } from "lucide-react";
import type { Belief, KnowledgeSource, ResearchFinding, LibrarySearchResult } from "../types";
import { formatWithTimezone, parseApiDate } from "@/lib/datetime";

type LibraryTab = "memories" | "documents" | "findings";

function formatDate(dateStr: string): string {
  const d = parseApiDate(dateStr);
  return isNaN(d.getTime()) ? dateStr : formatWithTimezone(d, { year: "numeric", month: "numeric", day: "numeric" });
}

const confidenceColor = (c: number) => {
  if (c >= 0.8) return "text-green-400 bg-green-500/15 border-green-500/30";
  if (c >= 0.5) return "text-amber-400 bg-amber-500/15 border-amber-500/30";
  return "text-red-400 bg-red-500/15 border-red-500/30";
};

const domainColorMap: Record<string, string> = {
  general: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  tech: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  finance: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  science: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  health: "bg-pink-500/15 text-pink-400 border-pink-500/30",
};

export default function Library() {
  const [tab, setTab] = useState<LibraryTab>("memories");

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { document.title = "Library - pai"; }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // Data hooks
  const { data: stats } = useLibraryStats();
  const { data: searchResults = [], isFetching: isSearching } = useLibrarySearch(searchQuery);

  const isSearchMode = searchQuery.trim().length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="space-y-2 border-b border-border/40 bg-background px-3 py-3 md:space-y-4 md:px-6 md:py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 font-mono text-sm font-semibold text-foreground">
              Library
            </h1>
          </div>
        </div>

        {stats && (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {stats.beliefs.active} memories
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {stats.documentsCount} documents
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {stats.findingsCount} findings
            </Badge>
          </div>
        )}

        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search across memories, documents, and findings..."
            className="w-full rounded-lg border border-border/50 bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
          />
        </div>

        {!isSearchMode && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as LibraryTab)}>
            <TabsList className="h-8">
              <TabsTrigger value="memories" className="gap-1.5 text-xs">
                <BrainIcon className="size-3" />
                Memories
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5 text-xs">
                <FileTextIcon className="size-3" />
                Documents
              </TabsTrigger>
              <TabsTrigger value="findings" className="gap-1.5 text-xs">
                <FlaskConicalIcon className="size-3" />
                Findings
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4 md:p-6">
          {isSearchMode ? (
            <SearchResultsView results={searchResults} isSearching={isSearching} query={searchQuery} />
          ) : tab === "memories" ? (
            <MemoriesTab />
          ) : tab === "documents" ? (
            <DocumentsTab />
          ) : (
            <FindingsTab />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Search results ----

function SearchResultsView({
  results,
  isSearching,
  query,
}: {
  results: LibrarySearchResult[];
  isSearching: boolean;
  query: string;
}) {
  const sourceTypeIcon: Record<string, React.ReactNode> = {
    memory: <BrainIcon className="size-3" />,
    document: <FileTextIcon className="size-3" />,
    finding: <FlaskConicalIcon className="size-3" />,
  };

  const sourceTypeColor: Record<string, string> = {
    memory: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    document: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    finding: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };

  return (
    <div>
      <p className="mb-4 text-xs text-muted-foreground">
        {isSearching ? "Searching..." : `${results.length} result${results.length !== 1 ? "s" : ""} for "${query}"`}
      </p>
      {results.length === 0 && !isSearching ? (
        <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
          <SearchIcon className="mb-4 size-12 opacity-20" />
          No matching results found.
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <Card
              key={`${r.sourceType}-${r.id}`}
              className="border-border/50 bg-card/50 transition-colors hover:border-border/80 hover:bg-card/70"
            >
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="outline" className={cn("gap-1 text-[10px]", sourceTypeColor[r.sourceType])}>
                    {sourceTypeIcon[r.sourceType]}
                    {r.sourceType}
                  </Badge>
                  <span className="text-xs font-medium text-foreground/80 line-clamp-1">
                    {r.title}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/70 line-clamp-2">
                  {r.snippet}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Memories tab ----

function MemoriesTab() {
  const { data: beliefs = [], isLoading } = useBeliefs({ status: "active" });

  const sorted = useMemo(
    () => [...beliefs].sort((a, b) => b.confidence - a.confidence),
    [beliefs],
  );

  if (isLoading) return <GridSkeleton />;

  if (sorted.length === 0) {
    return (
      <EmptyState icon={<BrainIcon className="size-12" />} message="No memories yet." sub="Start chatting to build your memory." />
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {sorted.map((b) => (
        <MemoryCard key={b.id} belief={b} />
      ))}
    </div>
  );
}

function MemoryCard({ belief }: { belief: Belief }) {
  return (
    <Card className="border-border/50 bg-card/50 transition-colors hover:border-border/80 hover:bg-card/70">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px] capitalize">
            {belief.type}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px]", confidenceColor(belief.confidence))}>
            {Math.round(belief.confidence * 100)}%
          </Badge>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-foreground/90 line-clamp-3">
          {belief.statement}
        </p>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          {belief.subject && <span className="capitalize">{belief.subject}</span>}
          <span className="ml-auto">{formatDate(belief.created_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Documents tab ----

function DocumentsTab() {
  const { data: sources = [], isLoading } = useKnowledgeSources();

  if (isLoading) return <GridSkeleton />;

  if (sources.length === 0) {
    return (
      <EmptyState icon={<FileTextIcon className="size-12" />} message="No documents yet." sub="Use the Documents page to learn from web pages." />
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {sources.map((s) => (
        <DocumentCard key={s.id} source={s} />
      ))}
    </div>
  );
}

function DocumentCard({ source }: { source: KnowledgeSource }) {
  return (
    <Card className="border-border/50 bg-card/50 transition-colors hover:border-border/80 hover:bg-card/70">
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-tight text-foreground/90 line-clamp-2">
            {source.title || "Untitled"}
          </h3>
          <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
            {source.chunks} chunk{source.chunks !== 1 ? "s" : ""}
          </Badge>
        </div>
        <p className="mb-3 truncate text-xs text-muted-foreground">
          {source.url}
        </p>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>{formatDate(source.learnedAt)}</span>
          <span className="font-mono">{source.id.slice(0, 8)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Findings tab ----

function FindingsTab() {
  const { data: findings = [], isLoading } = useFindings();

  const sorted = useMemo(
    () => [...findings].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [findings],
  );

  if (isLoading) return <GridSkeleton />;

  if (sorted.length === 0) {
    return (
      <EmptyState icon={<FlaskConicalIcon className="size-12" />} message="No findings yet." sub="Findings are generated when watches run research." />
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {sorted.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
    </div>
  );
}

function FindingCard({ finding }: { finding: ResearchFinding }) {
  const domainClass = domainColorMap[finding.domain] ?? domainColorMap.general;

  return (
    <Card className="border-border/50 bg-card/50 transition-colors hover:border-border/80 hover:bg-card/70">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px]", domainClass)}>
            {finding.domain}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px]", confidenceColor(finding.confidence))}>
            {Math.round(finding.confidence * 100)}%
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            {finding.agentName}
          </span>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-foreground/90 line-clamp-3">
          {finding.summary}
        </p>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <Badge variant="secondary" className="text-[9px]">{finding.depthLevel}</Badge>
          <span>{formatDate(finding.createdAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Shared components ----

function GridSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-10" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, message, sub }: { icon: React.ReactNode; message: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
      <div className="mb-4 opacity-20">{icon}</div>
      <p>{message}</p>
      <p className="mt-1 text-xs">{sub}</p>
    </div>
  );
}
