import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createProgramApi,
  deleteProgramApi,
  getPrograms,
  pauseProgramApi,
  resumeProgramApi,
  updateProgramApi,
} from "../api";
import type { Program } from "../api";

export const programKeys = {
  all: ["programs"] as const,
  list: () => ["programs", "list"] as const,
};

export function usePrograms() {
  return useQuery({
    queryKey: programKeys.list(),
    queryFn: () => getPrograms(),
    refetchInterval: 30_000,
  });
}

export function useCreateProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      title: string;
      question: string;
      family?: "general" | "work" | "travel" | "buying";
      executionMode?: "research" | "analysis";
      intervalHours?: number;
      startAt?: string;
      preferences?: string[];
      constraints?: string[];
      openQuestions?: string[];
    }) => createProgramApi(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useUpdateProgram() {
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
    }) => updateProgramApi(input.id, input.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useDeleteProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProgramApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: programKeys.all });
      const prev = queryClient.getQueriesData<Program[]>({ queryKey: programKeys.all });
      queryClient.setQueriesData<Program[]>({ queryKey: programKeys.all }, (old) =>
        old?.filter((program) => program.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function usePauseProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pauseProgramApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: programKeys.all });
      const prev = queryClient.getQueriesData<Program[]>({ queryKey: programKeys.all });
      queryClient.setQueriesData<Program[]>({ queryKey: programKeys.all }, (old) =>
        old?.map((program) => (program.id === id ? { ...program, status: "paused" } : program)),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}

export function useResumeProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeProgramApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: programKeys.all });
      const prev = queryClient.getQueriesData<Program[]>({ queryKey: programKeys.all });
      queryClient.setQueriesData<Program[]>({ queryKey: programKeys.all }, (old) =>
        old?.map((program) => (program.id === id ? { ...program, status: "active" } : program)),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.all });
    },
  });
}
