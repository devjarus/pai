import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getThreads,
  createThread,
  deleteThread,
  clearAllThreads,
  renameThread,
  getThreadMessages,
} from "../api";
import type { Thread } from "../types";

export const threadKeys = {
  all: ["threads"] as const,
  list: () => ["threads", "list"] as const,
  messages: (id: string) => ["threads", "messages", id] as const,
};

export function useThreads() {
  return useQuery({
    queryKey: threadKeys.list(),
    queryFn: () => getThreads(),
  });
}

export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: threadKeys.messages(threadId!),
    queryFn: () => getThreadMessages(threadId!),
    enabled: !!threadId,
  });
}

export function useCreateThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input?: { title?: string; agentName?: string }) =>
      createThread(input?.title, input?.agentName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.all });
    },
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteThread(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: threadKeys.all });
      const prev = queryClient.getQueriesData<Thread[]>({ queryKey: threadKeys.all });
      queryClient.setQueriesData<Thread[]>({ queryKey: threadKeys.all }, (old) =>
        old?.filter((t) => t.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.all });
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title: string }) =>
      renameThread(input.id, input.title),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: threadKeys.all });
      const prev = queryClient.getQueriesData<Thread[]>({ queryKey: threadKeys.all });
      queryClient.setQueriesData<Thread[]>({ queryKey: threadKeys.all }, (old) =>
        old?.map((t) => (t.id === input.id ? { ...t, title: input.title } : t)),
      );
      return { prev };
    },
    onError: (_err, _input, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.all });
    },
  });
}

export function useClearAllThreads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearAllThreads(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.all });
    },
  });
}
