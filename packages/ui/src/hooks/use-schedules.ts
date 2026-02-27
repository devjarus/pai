import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSchedules,
  createScheduleApi,
  deleteScheduleApi,
  pauseScheduleApi,
  resumeScheduleApi,
} from "../api";

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

export function usePauseSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pauseScheduleApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

export function useResumeSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeScheduleApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}
