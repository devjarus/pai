import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getWatches,
  getWatchApi,
  getWatchHistoryApi,
  getWatchTemplates,
  createWatchApi,
  createWatchFromTemplateApi,
  updateWatchApi,
  deleteWatchApi,
  pauseWatchApi,
  resumeWatchApi,
  triggerWatchRunApi,
} from "../api";
import type { Program } from "../api";

export const watchKeys = {
  all: ["watches"] as const,
  list: () => ["watches", "list"] as const,
  detail: (id: string) => ["watches", "detail", id] as const,
  history: (id: string) => ["watches", "history", id] as const,
  templates: () => ["watches", "templates"] as const,
};

export function useWatches() {
  return useQuery({
    queryKey: watchKeys.list(),
    queryFn: () => getWatches(),
    refetchInterval: 30_000,
    refetchOnMount: "always",
  });
}

export function useWatch(id: string) {
  return useQuery({
    queryKey: watchKeys.detail(id),
    queryFn: () => getWatchApi(id),
    enabled: !!id,
  });
}

export function useWatchHistory(id: string) {
  return useQuery({
    queryKey: watchKeys.history(id),
    queryFn: () => getWatchHistoryApi(id),
    enabled: !!id,
  });
}

export function useWatchTemplates() {
  return useQuery({
    queryKey: watchKeys.templates(),
    queryFn: () => getWatchTemplates(),
  });
}

export function useCreateWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      question: string;
      family?: "general" | "work" | "travel" | "buying";
      executionMode?: "research" | "analysis";
      intervalHours?: number;
      startAt?: string;
      chatId?: number | null;
      threadId?: string | null;
      preferences?: string[];
      constraints?: string[];
      openQuestions?: string[];
    }) => createWatchApi(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: watchKeys.all });
    },
  });
}

export function useCreateWatchFromTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { templateId: string; subject: string }) =>
      createWatchFromTemplateApi(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: watchKeys.all });
    },
  });
}

export function useUpdateWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      data: {
        title?: string;
        question?: string;
        family?: "general" | "work" | "travel" | "buying";
        executionMode?: "research" | "analysis";
        intervalHours?: number;
        startAt?: string;
        preferences?: string[];
        constraints?: string[];
        openQuestions?: string[];
      };
    }) => updateWatchApi(input.id, input.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: watchKeys.all });
    },
  });
}

export function useDeleteWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWatchApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: watchKeys.all });
      const prev = queryClient.getQueriesData<Program[]>({ queryKey: watchKeys.all });
      queryClient.setQueriesData<Program[]>({ queryKey: watchKeys.all }, (old) =>
        old?.filter((watch) => watch.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: watchKeys.all });
    },
  });
}

export function usePauseWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pauseWatchApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: watchKeys.all });
      const prev = queryClient.getQueriesData<Program[]>({ queryKey: watchKeys.all });
      queryClient.setQueriesData<Program[]>({ queryKey: watchKeys.all }, (old) =>
        old?.map((watch) => (watch.id === id ? { ...watch, status: "paused" } : watch)),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: watchKeys.all });
    },
  });
}

export function useResumeWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeWatchApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: watchKeys.all });
      const prev = queryClient.getQueriesData<Program[]>({ queryKey: watchKeys.all });
      queryClient.setQueriesData<Program[]>({ queryKey: watchKeys.all }, (old) =>
        old?.map((watch) => (watch.id === id ? { ...watch, status: "active" } : watch)),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: watchKeys.all });
    },
  });
}

export function useTriggerWatchRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => triggerWatchRunApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: watchKeys.all });
    },
  });
}
