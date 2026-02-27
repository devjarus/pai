import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGoals, createGoal, completeGoal, deleteGoal } from "../api";
import { taskKeys } from "./use-tasks";

export const goalKeys = {
  all: ["goals"] as const,
  list: (status?: "active" | "done" | "all") =>
    ["goals", "list", status] as const,
};

export function useGoals(status?: "active" | "done" | "all") {
  return useQuery({
    queryKey: goalKeys.list(status),
    queryFn: () => getGoals(status),
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; description?: string }) =>
      createGoal(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useCompleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => completeGoal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGoal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: goalKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
