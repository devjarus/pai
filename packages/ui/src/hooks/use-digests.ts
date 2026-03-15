import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDigests,
  getDigest,
  getDigestSources,
  refreshDigests,
  correctDigest,
  rateDigest,
  rerunDigestResearch,
  getDigestSuggestions,
} from "../api";

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

export function useRerunDigestResearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rerunDigestResearch(id),
    onSuccess: () => {
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
