import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getThreads,
  createThread,
  deleteThread,
  clearAllThreads,
  renameThread,
  getThreadMessages,
} from "../api";

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.all });
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title: string }) =>
      renameThread(input.id, input.title),
    onSuccess: () => {
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
