import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getKnowledgeSources,
  searchKnowledge,
  learnFromUrl,
  uploadKnowledgeDocument,
  crawlSubPages,
  getCrawlStatus,
  getSourceChunks,
  reindexKnowledge,
  reindexKnowledgeSource,
  deleteKnowledgeSource,
  updateKnowledgeSource,
} from "../api";
import type { KnowledgeSource } from "../types";

export const knowledgeKeys = {
  all: ["knowledge"] as const,
  sources: () => ["knowledge", "sources"] as const,
  search: (q: string) => ["knowledge", "search", q] as const,
  crawlStatus: () => ["knowledge", "crawlStatus"] as const,
  chunks: (id: string) => ["knowledge", "chunks", id] as const,
};

export function useKnowledgeSources() {
  return useQuery({
    queryKey: knowledgeKeys.sources(),
    queryFn: () => getKnowledgeSources(),
  });
}

export function useSearchKnowledge(query: string) {
  return useQuery({
    queryKey: knowledgeKeys.search(query),
    queryFn: () => searchKnowledge(query),
    enabled: query.trim().length > 0,
  });
}

export function useCrawlStatus() {
  return useQuery({
    queryKey: knowledgeKeys.crawlStatus(),
    queryFn: () => getCrawlStatus(),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs;
      const hasActive = Array.isArray(jobs) && jobs.some((j: { status: string }) => j.status === "running" || j.status === "pending");
      return hasActive ? 3000 : false;
    },
  });
}

export function useSourceChunks(id: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.chunks(id!),
    queryFn: () => getSourceChunks(id!),
    enabled: !!id,
  });
}

export function useLearnFromUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      url: string;
      options?: { crawl?: boolean; force?: boolean };
    }) => learnFromUrl(input.url, input.options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}


export function useUploadKnowledgeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fileName: string; content: string; mimeType?: string; analyze?: boolean }) => uploadKnowledgeDocument(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

export function useCrawlSubPages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => crawlSubPages(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

export function useReindexKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reindexKnowledge(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

export function useReindexKnowledgeSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reindexKnowledgeSource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

export function useDeleteKnowledgeSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeSource(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: knowledgeKeys.sources() });
      const prev = queryClient.getQueryData<KnowledgeSource[]>(knowledgeKeys.sources());
      queryClient.setQueryData<KnowledgeSource[]>(knowledgeKeys.sources(), (old) =>
        old?.filter((s) => s.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      if (context?.prev) queryClient.setQueryData(knowledgeKeys.sources(), context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

export function useUpdateKnowledgeSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; data: { tags: string | null } }) =>
      updateKnowledgeSource(input.id, input.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}
