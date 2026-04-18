import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDigests,
  getDigest,
  getDigestSources,
  refreshDigests,
  correctDigest,
  rateDigest,
  acceptDigestRecommendation,
  rerunDigestResearch,
  getDigestSuggestions,
  deleteDigest,
} from "../api";

type DigestListData = { digests: Array<{ id: string; generatedAt: string; sections: Record<string, unknown>; status: string; type: string }> };

export const digestKeys = {
  all: ["digests"] as const,
  list: () => ["digests", "list"] as const,
  detail: (id: string) => ["digests", "detail", id] as const,
  sources: (id: string) => ["digests", "sources", id] as const,
  suggestions: (id: string) => ["digests", "suggestions", id] as const,
};

export function useDigests() {
  return useQuery({
    queryKey: digestKeys.list(),
    queryFn: () => getDigests(),
  });
}

export function useDigest(id: string) {
  return useQuery({
    queryKey: digestKeys.detail(id),
    queryFn: () => getDigest(id),
    enabled: !!id,
  });
}

export function useDigestSources(id: string) {
  return useQuery({
    queryKey: digestKeys.sources(id),
    queryFn: () => getDigestSources(id),
    enabled: !!id,
  });
}

export function useRefreshDigests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshDigests(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: digestKeys.all });
    },
  });
}

export function useCorrectDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; beliefId: string; correctedStatement: string; note?: string }) =>
      correctDigest(input.id, { beliefId: input.beliefId, correctedStatement: input.correctedStatement, note: input.note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: digestKeys.all });
      queryClient.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useRateDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; rating: number; feedback?: string }) =>
      rateDigest(input.id, { rating: input.rating, feedback: input.feedback }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: digestKeys.detail(variables.id) });
    },
  });
}

export function useAcceptDigestRecommendation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acceptDigestRecommendation(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: digestKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export function useRerunDigestResearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rerunDigestResearch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: digestKeys.all });
    },
  });
}

export function useDeleteDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDigest(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: digestKeys.all });
      const prev = queryClient.getQueriesData<DigestListData>({ queryKey: digestKeys.list() });
      queryClient.setQueriesData<DigestListData>({ queryKey: digestKeys.list() }, (old) =>
        old ? { ...old, digests: old.digests.filter((d) => d.id !== id) } : old,
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: digestKeys.all });
    },
  });
}

export function useDigestSuggestions(id: string) {
  return useQuery({
    queryKey: digestKeys.suggestions(id),
    queryFn: () => getDigestSuggestions(id),
    enabled: !!id,
  });
}
