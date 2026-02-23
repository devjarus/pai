import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { getKnowledgeSources, searchKnowledge, learnFromUrl, deleteKnowledgeSource, updateKnowledgeSource, getCrawlStatus, getSourceChunks, crawlSubPages } from "../api";
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
} from "lucide-react";
import type { KnowledgeSource, KnowledgeSearchResult, CrawlJob } from "../types";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(" ", "T"));
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
}

export default function Knowledge() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [selectedSource, setSelectedSource] = useState<KnowledgeSource | null>(null);
  const [showLearnDialog, setShowLearnDialog] = useState(false);
  const [learnUrl, setLearnUrl] = useState("");
  const [learnCrawl, setLearnCrawl] = useState(false);
  const [isLearning, setIsLearning] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<KnowledgeSource | null>(null);
  const [crawlJobs, setCrawlJobs] = useState<CrawlJob[]>([]);
  const [retryingUrl, setRetryingUrl] = useState<string | null>(null);
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set());
  // Chunk viewer dialog
  const [viewChunksSource, setViewChunksSource] = useState<KnowledgeSource | null>(null);
  const [chunks, setChunks] = useState<Array<{ id: string; content: string; chunkIndex: number }>>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);
  // Actions
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCrawling, setIsCrawling] = useState(false);
  // Tags editing
  const [editingTags, setEditingTags] = useState(false);
  const [tagsInput, setTagsInput] = useState("");

  useEffect(() => { document.title = "Knowledge Base - pai"; }, []);

  // Debounce search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const results = await getKnowledgeSources();
      setSources(results);
    } catch {
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  // Load chunks when viewer opens
  useEffect(() => {
    if (!viewChunksSource) return;
    let cancelled = false;
    setChunksLoading(true);
    setChunks([]);
    setExpandedChunk(null);
    getSourceChunks(viewChunksSource.id).then((result) => {
      if (!cancelled) setChunks(result);
    }).catch(() => {
      if (!cancelled) setChunks([]);
    }).finally(() => {
      if (!cancelled) setChunksLoading(false);
    });
    return () => { cancelled = true; };
  }, [viewChunksSource?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll crawl status when jobs are running
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { jobs } = await getCrawlStatus();
        if (!cancelled) setCrawlJobs(jobs);
      } catch { /* ignore */ }
    };
    poll();
    const hasRunning = crawlJobs.some((j) => j.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(() => {
      poll();
      fetchSources();
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [crawlJobs.some((j) => j.status === "running"), fetchSources]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search knowledge
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    searchKnowledge(searchQuery).then((results) => {
      if (!cancelled) setSearchResults(results);
    }).catch(() => {
      if (!cancelled) setSearchResults([]);
    }).finally(() => {
      if (!cancelled) setIsSearching(false);
    });
    return () => { cancelled = true; };
  }, [searchQuery]);

  const handleLearn = useCallback(async (forceRelearn = false) => {
    const url = learnUrl.trim();
    if (!url) return;
    setIsLearning(true);
    try {
      const result = await learnFromUrl(url, { crawl: learnCrawl, force: forceRelearn });
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
        const { jobs } = await getCrawlStatus();
        setCrawlJobs(jobs);
      }
      await fetchSources();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to learn from URL");
    } finally {
      setIsLearning(false);
    }
  }, [learnUrl, learnCrawl, fetchSources]);

  const handleRefresh = useCallback(async (source: KnowledgeSource) => {
    setIsRefreshing(true);
    try {
      const result = await learnFromUrl(source.url, { force: true });
      toast.success(`Re-learned "${result.title}" - ${result.chunks} chunks`);
      await fetchSources();
      // Update selected source
      const updated = (await getKnowledgeSources()).find((s) => s.url === source.url);
      if (updated) setSelectedSource(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to re-learn");
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchSources]);

  const handleCrawlSubPages = useCallback(async (source: KnowledgeSource) => {
    setIsCrawling(true);
    try {
      const result = await crawlSubPages(source.id);
      if (result.subPages === 0) {
        toast.info("No sub-pages found to crawl");
      } else {
        toast.success(`Crawling ${result.subPages} sub-pages in the background...`);
        const { jobs } = await getCrawlStatus();
        setCrawlJobs(jobs);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to crawl sub-pages");
    } finally {
      setIsCrawling(false);
    }
  }, []);

  const handleSaveTags = useCallback(async (source: KnowledgeSource) => {
    const newTags = tagsInput.trim() || null;
    try {
      await updateKnowledgeSource(source.id, { tags: newTags });
      setSelectedSource({ ...source, tags: newTags });
      setSources((prev) => prev.map((s) => s.id === source.id ? { ...s, tags: newTags } : s));
      setEditingTags(false);
      toast.success("Tags updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tags");
    }
  }, [tagsInput]);

  const handleRetryUrl = useCallback(async (url: string) => {
    setRetryingUrl(url);
    try {
      const result = await learnFromUrl(url);
      if (result.skipped) {
        toast.info(`Already learned from "${result.title}"`);
      } else {
        toast.success(`Learned from "${result.title}" - ${result.chunks} chunks`);
      }
      await fetchSources();
      const { jobs } = await getCrawlStatus();
      setCrawlJobs(jobs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to learn from ${url}`);
    } finally {
      setRetryingUrl(null);
    }
  }, [fetchSources]);

  const handleDelete = useCallback(async (source: KnowledgeSource) => {
    try {
      await deleteKnowledgeSource(source.id);
      toast.success(`Removed "${source.title}"`);
      setShowDeleteConfirm(null);
      if (selectedSource?.id === source.id) setSelectedSource(null);
      await fetchSources();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove source");
    }
  }, [fetchSources, selectedSource]);

  const isSearchMode = searchQuery.trim().length > 0;
  const runningJobs = crawlJobs.filter((j) => j.status === "running");
  const doneJobsWithFailures = crawlJobs.filter((j) => j.status !== "running" && j.failedUrls.length > 0 && !dismissedJobs.has(j.url));

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" onClick={() => setShowLearnDialog(true)}>
                  <PlusIcon className="size-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Learn from URL</TooltipContent>
            </Tooltip>
          </div>

          {/* Search */}
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

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-4 md:p-6">
            {/* Crawl progress banners */}
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

            {/* Failed pages banners */}
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
                      <Card key={i} className="border-border/50 bg-card/50">
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
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {sources.map((s) => (
                  <Card
                    key={s.id}
                    className="cursor-pointer border-border/50 bg-card/50 transition-colors hover:border-border/80 hover:bg-card/70"
                    onClick={() => setSelectedSource(s)}
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
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
                        <span>{formatDate(s.learnedAt)}</span>
                        <span className="font-mono">{s.id.slice(0, 8)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detail sidebar backdrop (mobile) */}
      {selectedSource && (
        <div
          className="fixed inset-0 z-[51] bg-black/60 md:hidden"
          onClick={() => setSelectedSource(null)}
        />
      )}

      {/* Detail sidebar */}
      {selectedSource && (
        <aside className="fixed inset-y-0 right-0 z-[52] w-[85vw] max-w-96 overflow-hidden border-l border-border/40 bg-[#0a0a0a] md:relative md:z-auto md:w-96 md:max-w-none">
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
                    onClick={() => setSelectedSource(null)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </Button>
                </CardHeader>

                <CardContent className="space-y-4 px-4 py-0">
                  {/* Title */}
                  <p className="text-sm font-medium leading-relaxed text-foreground/90">
                    {selectedSource.title || "Untitled"}
                  </p>

                  {/* URL */}
                  <a
                    href={selectedSource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-1.5 text-xs text-primary/80 transition-colors hover:text-primary"
                  >
                    <ExternalLinkIcon className="size-3 shrink-0" />
                    <span className="break-all">{selectedSource.url}</span>
                  </a>

                  <Separator className="opacity-30" />

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Chunks</span>
                      <span className="font-mono text-sm text-foreground">{selectedSource.chunks}</span>
                    </div>
                    <div>
                      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Learned</span>
                      <span className="text-sm text-foreground">{formatDate(selectedSource.learnedAt)}</span>
                    </div>
                  </div>

                  <Separator className="opacity-30" />

                  {/* ID */}
                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">ID</span>
                    <span className="block break-all font-mono text-xs text-muted-foreground">{selectedSource.id}</span>
                  </div>

                  <Separator className="opacity-30" />

                  {/* Tags */}
                  <div className="min-w-0">
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tags</span>
                    {editingTags ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={tagsInput}
                          onChange={(e) => setTagsInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveTags(selectedSource); if (e.key === "Escape") setEditingTags(false); }}
                          placeholder="e.g. Monica article, cooking"
                          className="min-w-0 flex-1 rounded border border-border/50 bg-background/50 px-2 py-1 text-xs text-foreground outline-none focus:border-primary/50"
                          autoFocus
                        />
                        <Button variant="ghost" size="icon-xs" onClick={() => handleSaveTags(selectedSource)}>
                          <CheckIcon className="size-3.5 text-green-500" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setTagsInput(selectedSource.tags ?? ""); setEditingTags(true); }}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <TagIcon className="size-3 shrink-0" />
                        <span>{selectedSource.tags || "Add tags..."}</span>
                      </button>
                    )}
                  </div>

                  <Separator className="opacity-30" />

                  {/* Action buttons */}
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setViewChunksSource(selectedSource)}
                    >
                      <EyeIcon className="mr-1.5 size-3.5" />
                      View contents
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleRefresh(selectedSource)}
                      disabled={isRefreshing}
                    >
                      <RefreshCwIcon className={`mr-1.5 size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                      {isRefreshing ? "Re-learning..." : "Re-learn (refresh)"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleCrawlSubPages(selectedSource)}
                      disabled={isCrawling}
                    >
                      <GlobeIcon className={`mr-1.5 size-3.5 ${isCrawling ? "animate-spin" : ""}`} />
                      {isCrawling ? "Discovering..." : "Crawl sub-pages"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowDeleteConfirm(selectedSource)}
                    >
                      <Trash2Icon className="mr-1.5 size-3.5" />
                      Remove source
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </aside>
      )}

      {/* Chunk Viewer Dialog — full screen */}
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

      {/* Learn from URL Dialog */}
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

      {/* Delete Confirmation Dialog */}
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

function IconBook() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
