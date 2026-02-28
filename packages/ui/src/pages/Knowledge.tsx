import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useKnowledgeSources,
  useSearchKnowledge,
  useCrawlStatus,
  useSourceChunks,
  useLearnFromUrl,
  useCrawlSubPages,
  useDeleteKnowledgeSource,
  useReindexKnowledge,
  useUpdateKnowledgeSource,
} from "@/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Trash2Icon, ExternalLinkIcon, SearchIcon, PlusIcon, AlertTriangleIcon,
  RefreshCwIcon, LoaderIcon, EyeIcon, GlobeIcon, TagIcon, CheckIcon,
  ChevronRightIcon,
} from "lucide-react";
import type { KnowledgeSource, KnowledgeSearchResult } from "../types";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(" ", "T"));
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  return tags.split(",").map((t) => t.trim()).filter(Boolean);
}

export default function Knowledge() {
  const isMobile = useIsMobile();

  // --- Debounced search state ---
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // --- UI toggle / dialog state ---
  const [selectedSource, setSelectedSource] = useState<KnowledgeSource | null>(null);
  const [showLearnDialog, setShowLearnDialog] = useState(false);
  const [learnUrl, setLearnUrl] = useState("");
  const [learnCrawl, setLearnCrawl] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<KnowledgeSource | null>(null);
  const [retryingUrl, setRetryingUrl] = useState<string | null>(null);
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set());
  const [viewChunksSource, setViewChunksSource] = useState<KnowledgeSource | null>(null);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [filterTag, setFilterTag] = useState<string>("");

  // --- TanStack Query hooks ---
  const { data: sources = [], isLoading: loading } = useKnowledgeSources();
  const { data: searchResults = [], isFetching: isSearching } = useSearchKnowledge(searchQuery);
  const { data: crawlData } = useCrawlStatus();
  const crawlJobs = crawlData?.jobs ?? [];
  const { data: chunks = [], isLoading: chunksLoading } = useSourceChunks(viewChunksSource?.id ?? null);

  // --- Mutations ---
  const learnMutation = useLearnFromUrl();
  const crawlSubPagesMutation = useCrawlSubPages();
  const deleteMutation = useDeleteKnowledgeSource();
  const reindexMutation = useReindexKnowledge();
  const updateTagsMutation = useUpdateKnowledgeSource();

  useEffect(() => { document.title = "Knowledge Base - pai"; }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // Reset expanded chunk when viewing a different source
  useEffect(() => {
    setExpandedChunk(null);
  }, [viewChunksSource?.id]);

  const handleLearn = async (forceRelearn = false) => {
    const url = learnUrl.trim();
    if (!url) return;
    try {
      const result = await learnMutation.mutateAsync({ url, options: { crawl: learnCrawl, force: forceRelearn } });
      if (result.skipped) {
        toast(`Already learned from "${result.title}"`, {
          action: {
            label: "Re-learn",
            onClick: () => handleLearn(true),
          },
        });
      } else {
        toast.success(`${forceRelearn ? "Re-learned" : "Learned"} from "${result.title}" - ${result.chunks} chunks`);
        setLearnUrl("");
        setLearnCrawl(false);
        setShowLearnDialog(false);
      }
      if (result.crawling) {
        toast.info(`Crawling ${result.subPages} sub-pages in the background...`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to learn from URL");
    }
  };

  const handleRefresh = async (source: KnowledgeSource) => {
    try {
      const result = await learnMutation.mutateAsync({ url: source.url, options: { force: true } });
      toast.success(`Re-learned "${result.title}" - ${result.chunks} chunks`);
      // After invalidation, find the updated source from the refetched list
      const updated = sources.find((s) => s.url === source.url);
      if (updated) setSelectedSource(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to re-learn");
    }
  };

  const handleCrawlSubPages = async (source: KnowledgeSource) => {
    try {
      const result = await crawlSubPagesMutation.mutateAsync(source.id);
      if (result.subPages === 0) {
        toast.info("No sub-pages found to crawl");
      } else {
        toast.success(`Crawling ${result.subPages} sub-pages in the background...`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to crawl sub-pages");
    }
  };

  const handleSaveTags = async (source: KnowledgeSource) => {
    const newTags = tagsInput.trim() || null;
    try {
      await updateTagsMutation.mutateAsync({ id: source.id, data: { tags: newTags } });
      setSelectedSource({ ...source, tags: newTags });
      setEditingTags(false);
      toast.success("Tags updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tags");
    }
  };

  const handleRetryUrl = async (url: string) => {
    setRetryingUrl(url);
    try {
      const result = await learnMutation.mutateAsync({ url });
      if (result.skipped) {
        toast.info(`Already learned from "${result.title}"`);
      } else {
        toast.success(`Learned from "${result.title}" - ${result.chunks} chunks`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to learn from ${url}`);
    } finally {
      setRetryingUrl(null);
    }
  };

  const handleReindex = async () => {
    try {
      const result = await reindexMutation.mutateAsync();
      toast.success(`Re-indexed ${result.reindexed} source${result.reindexed !== 1 ? "s" : ""} with contextual headers`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to re-index");
    }
  };

  const handleDelete = async (source: KnowledgeSource) => {
    try {
      await deleteMutation.mutateAsync(source.id);
      toast.success(`Removed "${source.title}"`);
      setShowDeleteConfirm(null);
      if (selectedSource?.id === source.id) setSelectedSource(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove source");
    }
  };

  const handleSearchResultClick = (result: KnowledgeSearchResult) => {
    const source = sources.find((s) => s.id === result.sourceId);
    if (source) {
      setSelectedSource(source);
      setSearchInput("");
    }
  };

  // Derived state
  const isRefreshing = learnMutation.isPending;
  const isCrawling = crawlSubPagesMutation.isPending;
  const isReindexing = reindexMutation.isPending;
  const isLearning = learnMutation.isPending;

  const allTags = [...new Set(sources.flatMap((s) => parseTags(s.tags)))];

  const filteredSources = filterTag
    ? sources.filter((s) => parseTags(s.tags).includes(filterTag))
    : sources;

  const groupedSources = (() => {
    const byDomain: Record<string, KnowledgeSource[]> = {};
    for (const s of filteredSources) {
      try { const d = new URL(s.url).hostname; (byDomain[d] ??= []).push(s); } catch { (byDomain["other"] ??= []).push(s); }
    }
    const groups: Array<{ domain: string; sources: KnowledgeSource[]; collapsed: boolean }> = [];
    for (const [domain, domainSources] of Object.entries(byDomain)) {
      groups.push({ domain, sources: domainSources, collapsed: domainSources.length >= 3 });
    }
    return groups.sort((a, b) => {
      if (a.collapsed !== b.collapsed) return a.collapsed ? 1 : -1;
      return b.sources.length - a.sources.length;
    });
  })();

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain); else next.add(domain);
      return next;
    });
  };

  const isSearchMode = searchQuery.trim().length > 0;
  const runningJobs = crawlJobs.filter((j) => j.status === "running");
  const doneJobsWithFailures = crawlJobs.filter((j) => j.status !== "running" && j.failedUrls.length > 0 && !dismissedJobs.has(j.url));

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="space-y-4 border-b border-border/40 bg-[#0a0a0a] px-4 py-4 md:px-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="shrink-0 font-mono text-sm font-semibold text-foreground">
                Knowledge Base
              </h1>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {sources.length} source{sources.length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={handleReindex} disabled={isReindexing || sources.length === 0}>
                    <RefreshCwIcon className={`size-4 text-muted-foreground ${isReindexing ? "animate-spin" : ""}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Re-index all sources with contextual headers</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={() => setShowLearnDialog(true)}>
                    <PlusIcon className="size-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Learn from URL</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search knowledge base..."
              className="w-full rounded-lg border border-border/50 bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">
            {runningJobs.map((job) => (
              <div key={job.url} className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <LoaderIcon className="size-4 shrink-0 animate-spin text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    Crawling: {job.learned + job.skipped + job.failed}/{job.total} pages
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">{job.url}</p>
                </div>
                <div className="flex gap-2 text-[10px]">
                  <span className="text-green-400">{job.learned} learned</span>
                  {job.failed > 0 && <span className="text-red-400">{job.failed} failed</span>}
                </div>
              </div>
            ))}

            {doneJobsWithFailures.map((job) => (
              <div key={job.url} className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
                  <p className="min-w-0 flex-1 text-xs font-medium text-foreground">
                    {job.failedUrls.length} page{job.failedUrls.length !== 1 ? "s" : ""} failed to load
                  </p>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    ({job.learned} learned, {job.skipped} skipped)
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setDismissedJobs((prev) => new Set([...prev, job.url]))}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </Button>
                </div>
                <div className="space-y-1.5 overflow-hidden">
                  {job.failedUrls.map((url) => (
                    <div key={url} className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{url}</span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRetryUrl(url)}
                        disabled={retryingUrl === url}
                        className="shrink-0"
                      >
                        <RefreshCwIcon className={`size-3 ${retryingUrl === url ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {loading ? (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-4">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isSearchMode ? (
              <div>
                <p className="mb-4 text-xs text-muted-foreground">
                  {isSearching ? "Searching..." : `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${searchQuery}"`}
                </p>
                {searchResults.length === 0 && !isSearching ? (
                  <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
                    <SearchIcon className="mb-4 size-12 opacity-20" />
                    No matching knowledge found.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((r, i) => (
                      <Card
                        key={i}
                        className="cursor-pointer border-border/50 bg-card/50 transition-colors hover:border-border/80 hover:bg-card/70"
                        onClick={() => handleSearchResultClick(r)}
                      >
                        <CardContent className="p-4">
                          <div className="mb-2 flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {r.relevance}%
                            </Badge>
                            <span className="text-xs font-medium text-foreground/80">{r.source}</span>
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLinkIcon className="size-3.5" />
                            </a>
                          </div>
                          <p className="text-sm leading-relaxed text-foreground/70">
                            {r.content.slice(0, 300)}{r.content.length > 300 ? "..." : ""}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            ) : sources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
                <div className="mb-4 opacity-20">
                  <IconBook />
                </div>
                <p>Knowledge base is empty.</p>
                <p className="mt-1 text-xs">Use the + button to learn from a web page.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {allTags.length >= 2 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFilterTag("")}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        filterTag === ""
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      }`}
                    >
                      All
                    </button>
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setFilterTag(filterTag === tag ? "" : tag)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          filterTag === tag
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {groupedSources.map(({ domain, sources: domainSources, collapsed }) => {
                  if (!collapsed) {
                    return (
                      <div key={domain} className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                        {domainSources.map((s) => (
                          <SourceCard key={s.id} source={s} onClick={setSelectedSource} />
                        ))}
                      </div>
                    );
                  }
                  const isExpanded = expandedDomains.has(domain);
                  const totalChunks = domainSources.reduce((sum, s) => sum + s.chunks, 0);
                  return (
                    <div key={domain}>
                      <button
                        type="button"
                        onClick={() => toggleDomain(domain)}
                        className="mb-3 flex w-full items-center gap-2 rounded-lg border border-border/50 bg-card/30 px-4 py-2.5 text-left transition-colors hover:bg-card/50"
                      >
                        <ChevronRightIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/80">{domain}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {domainSources.length} page{domainSources.length !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {totalChunks} chunk{totalChunks !== 1 ? "s" : ""}
                        </Badge>
                      </button>
                      {isExpanded && (
                        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                          {domainSources.map((s) => (
                            <SourceCard key={s.id} source={s} onClick={setSelectedSource} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedSource && (isMobile ? (
        <Sheet open={!!selectedSource} onOpenChange={(open) => { if (!open) setSelectedSource(null); }}>
          <SheetContent side="right" showCloseButton={false} className="w-[85vw] max-w-96 gap-0 overflow-y-auto p-0">
            <SheetTitle className="sr-only">Source Detail</SheetTitle>
            <SourceDetailPanel source={selectedSource} onClose={() => setSelectedSource(null)} editingTags={editingTags} setEditingTags={setEditingTags} tagsInput={tagsInput} setTagsInput={setTagsInput} handleSaveTags={handleSaveTags} setViewChunksSource={setViewChunksSource} handleRefresh={handleRefresh} isRefreshing={isRefreshing} handleCrawlSubPages={handleCrawlSubPages} isCrawling={isCrawling} setShowDeleteConfirm={setShowDeleteConfirm} />
          </SheetContent>
        </Sheet>
      ) : (
        <aside className="relative z-auto w-96 overflow-hidden border-l border-border/40 bg-[#0a0a0a]">
          <SourceDetailPanel source={selectedSource} onClose={() => setSelectedSource(null)} editingTags={editingTags} setEditingTags={setEditingTags} tagsInput={tagsInput} setTagsInput={setTagsInput} handleSaveTags={handleSaveTags} setViewChunksSource={setViewChunksSource} handleRefresh={handleRefresh} isRefreshing={isRefreshing} handleCrawlSubPages={handleCrawlSubPages} isCrawling={isCrawling} setShowDeleteConfirm={setShowDeleteConfirm} />
        </aside>
      ))}

      <Dialog open={!!viewChunksSource} onOpenChange={() => setViewChunksSource(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {viewChunksSource?.title || "Untitled"} — {viewChunksSource?.chunks} chunks
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 pr-4">
              {chunksLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : chunks.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No chunks found.</p>
              ) : (
                chunks.map((chunk) => {
                  const isExpanded = expandedChunk === chunk.id;
                  const isLong = chunk.content.length > 400;
                  return (
                    <div
                      key={chunk.id}
                      className="rounded-lg border border-border/40 bg-card/30 p-4"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          Chunk #{chunk.chunkIndex + 1}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {chunk.content.split(/\s+/).length} words
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                        {isExpanded || !isLong ? chunk.content : chunk.content.slice(0, 400) + "..."}
                      </p>
                      {isLong && (
                        <button
                          type="button"
                          onClick={() => setExpandedChunk(isExpanded ? null : chunk.id)}
                          className="mt-2 text-xs text-primary/70 transition-colors hover:text-primary"
                        >
                          {isExpanded ? "Show less" : "Show more"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={showLearnDialog} onOpenChange={setShowLearnDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Learn from URL</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Enter a web page URL. The content will be extracted, chunked, and stored in your knowledge base for future retrieval.
            </p>
            <input
              type="url"
              value={learnUrl}
              onChange={(e) => setLearnUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleLearn(); }}
              placeholder="https://example.com/article"
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              disabled={isLearning}
              autoFocus
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={learnCrawl}
                onChange={(e) => setLearnCrawl(e.target.checked)}
                disabled={isLearning}
                className="rounded border-border"
              />
              Also crawl sub-pages (for doc sites)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowLearnDialog(false)} disabled={isLearning}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => handleLearn()} disabled={isLearning || !learnUrl.trim()}>
                {isLearning ? "Learning..." : "Learn"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove Source</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Remove <strong className="text-foreground/80">&quot;{showDeleteConfirm?.title}&quot;</strong> and all its {showDeleteConfirm?.chunks} chunks from the knowledge base?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}>
                Remove
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SourceCard({ source: s, onClick }: { source: KnowledgeSource; onClick: (s: KnowledgeSource) => void }) {
  const tags = parseTags(s.tags);
  return (
    <Card
      className="cursor-pointer border-border/50 bg-card/50 transition-colors hover:border-border/80 hover:bg-card/70"
      onClick={() => onClick(s)}
    >
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-tight text-foreground/90 line-clamp-2">
            {s.title || "Untitled"}
          </h3>
          <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
            {s.chunks} chunk{s.chunks !== 1 ? "s" : ""}
          </Badge>
        </div>
        <p className="mb-3 truncate text-xs text-muted-foreground">
          {s.url}
        </p>
        {tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>{formatDate(s.learnedAt)}</span>
          <span className="font-mono">{s.id.slice(0, 8)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function IconBook() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function SourceDetailPanel({
  source,
  onClose,
  editingTags,
  setEditingTags,
  tagsInput,
  setTagsInput,
  handleSaveTags,
  setViewChunksSource,
  handleRefresh,
  isRefreshing,
  handleCrawlSubPages,
  isCrawling,
  setShowDeleteConfirm,
}: {
  source: KnowledgeSource;
  onClose: () => void;
  editingTags: boolean;
  setEditingTags: (v: boolean) => void;
  tagsInput: string;
  setTagsInput: (v: string) => void;
  handleSaveTags: (s: KnowledgeSource) => void;
  setViewChunksSource: (s: KnowledgeSource | null) => void;
  handleRefresh: (s: KnowledgeSource) => void;
  isRefreshing: boolean;
  handleCrawlSubPages: (s: KnowledgeSource) => void;
  isCrawling: boolean;
  setShowDeleteConfirm: (s: KnowledgeSource | null) => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5">
        <Card className="gap-4 border-border/50 bg-card/30 py-4">
          <CardHeader className="flex-row items-center justify-between px-4 py-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Source Detail
            </CardTitle>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Button>
          </CardHeader>

          <CardContent className="space-y-4 px-4 py-0">
            <p className="text-sm font-medium leading-relaxed text-foreground/90">
              {source.title || "Untitled"}
            </p>

            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-1.5 text-xs text-primary/80 transition-colors hover:text-primary"
            >
              <ExternalLinkIcon className="size-3 shrink-0" />
              <span className="break-all">{source.url}</span>
            </a>

            <Separator className="opacity-30" />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Chunks</span>
                <span className="font-mono text-sm text-foreground">{source.chunks}</span>
              </div>
              <div>
                <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Learned</span>
                <span className="text-sm text-foreground">{formatDate(source.learnedAt)}</span>
              </div>
            </div>

            <Separator className="opacity-30" />

            <div className="min-w-0">
              <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">ID</span>
              <span className="block break-all font-mono text-xs text-muted-foreground">{source.id}</span>
            </div>

            <Separator className="opacity-30" />

            <div className="min-w-0">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tags</span>
              {editingTags ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveTags(source); if (e.key === "Escape") setEditingTags(false); }}
                    placeholder="e.g. Monica article, cooking"
                    className="min-w-0 flex-1 rounded border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                    autoFocus
                  />
                  <Button variant="ghost" size="icon-xs" onClick={() => handleSaveTags(source)}>
                    <CheckIcon className="size-3.5 text-green-500" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setTagsInput(source.tags ?? ""); setEditingTags(true); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <TagIcon className="size-3 shrink-0" />
                  <span>{source.tags || "Add tags..."}</span>
                </button>
              )}
            </div>

            <Separator className="opacity-30" />

            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setViewChunksSource(source)}
              >
                <EyeIcon className="mr-1.5 size-3.5" />
                View contents
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => handleRefresh(source)}
                disabled={isRefreshing}
              >
                <RefreshCwIcon className={`mr-1.5 size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Re-learning..." : "Re-learn (refresh)"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => handleCrawlSubPages(source)}
                disabled={isCrawling}
              >
                <GlobeIcon className={`mr-1.5 size-3.5 ${isCrawling ? "animate-spin" : ""}`} />
                {isCrawling ? "Discovering..." : "Crawl sub-pages"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => setShowDeleteConfirm(source)}
              >
                <Trash2Icon className="mr-1.5 size-3.5" />
                Remove source
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
