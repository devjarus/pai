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
    onSuccess: () => {
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
