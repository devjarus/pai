import { useQuery } from "@tanstack/react-query";
import { getAgents } from "../api";

export const agentKeys = {
  all: ["agents"] as const,
  list: () => ["agents", "list"] as const,
};

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: () => getAgents(),
    staleTime: 30_000,
  });
}
