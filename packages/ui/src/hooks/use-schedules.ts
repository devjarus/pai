import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSchedules,
  createScheduleApi,
  deleteScheduleApi,
  pauseScheduleApi,
  resumeScheduleApi,
} from "../api";
import type { Schedule } from "../api";

export const scheduleKeys = {
  all: ["schedules"] as const,
  list: () => ["schedules", "list"] as const,
};

export function useSchedules() {
  return useQuery({
    queryKey: scheduleKeys.list(),
    queryFn: () => getSchedules(),
    refetchInterval: 30_000,
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      label: string;
      goal: string;
      intervalHours?: number;
      startAt?: string;
    }) => createScheduleApi(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteScheduleApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: scheduleKeys.all });
      const prev = queryClient.getQueriesData<Schedule[]>({ queryKey: scheduleKeys.all });
      queryClient.setQueriesData<Schedule[]>({ queryKey: scheduleKeys.all }, (old) =>
        old?.filter((s) => s.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

export function usePauseSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pauseScheduleApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: scheduleKeys.all });
      const prev = queryClient.getQueriesData<Schedule[]>({ queryKey: scheduleKeys.all });
      queryClient.setQueriesData<Schedule[]>({ queryKey: scheduleKeys.all }, (old) =>
        old?.map((s) => (s.id === id ? { ...s, status: "paused" } : s)),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

export function useResumeSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeScheduleApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: scheduleKeys.all });
      const prev = queryClient.getQueriesData<Schedule[]>({ queryKey: scheduleKeys.all });
      queryClient.setQueriesData<Schedule[]>({ queryKey: scheduleKeys.all }, (old) =>
        old?.map((s) => (s.id === id ? { ...s, status: "active" } : s)),
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}
