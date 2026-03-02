import { useQuery } from "@tanstack/react-query";
import { getLearningRuns } from "../api";

export function useLearningRuns() {
  return useQuery({
    queryKey: ["learning", "runs"],
    queryFn: () => getLearningRuns(),
    refetchInterval: 30_000,
  });
}
