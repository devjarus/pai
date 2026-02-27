import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBeliefs,
  searchMemory,
  remember,
  forgetBelief,
  updateBelief,
  clearAllMemory,
  getStats,
} from "../api";
import type { Belief } from "../types";

export const beliefKeys = {
  all: ["beliefs"] as const,
  list: (params?: { status?: string; type?: string }) =>
    ["beliefs", "list", params] as const,
  search: (q: string) => ["beliefs", "search", q] as const,
  stats: () => ["beliefs", "stats"] as const,
};

export function useBeliefs(params?: { status?: string; type?: string }) {
  return useQuery({
    queryKey: beliefKeys.list(params),
    queryFn: () => getBeliefs(params),
  });
}

export function useSearchMemory(query: string) {
  return useQuery({
    queryKey: beliefKeys.search(query),
    queryFn: () => searchMemory(query),
    enabled: query.trim().length > 0,
  });
}

export function useMemoryStats() {
  return useQuery({
    queryKey: beliefKeys.stats(),
    queryFn: () => getStats(),
  });
}

export function useRemember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => remember(text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: beliefKeys.all });
    },
  });
}

export function useForgetBelief() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => forgetBelief(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: beliefKeys.all });
      const prev = queryClient.getQueriesData<Belief[]>({ queryKey: beliefKeys.all });
      queryClient.setQueriesData<Belief[]>({ queryKey: beliefKeys.all }, (old) =>
        old?.map((b) => (b.id === id ? { ...b, status: "forgotten" } : b)),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: beliefKeys.all });
    },
  });
}

export function useUpdateBelief() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; statement: string }) =>
      updateBelief(input.id, input.statement),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: beliefKeys.all });
    },
  });
}

export function useClearAllMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearAllMemory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: beliefKeys.all });
    },
  });
}
