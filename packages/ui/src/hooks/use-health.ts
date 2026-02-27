import { useQuery } from "@tanstack/react-query";

export interface HealthStatus {
  ok: boolean;
  provider: string;
}

async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch("/api/health", {
    credentials: "include",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { ok: false, provider: "unknown" };
  return res.json();
}

export const healthKeys = {
  status: () => ["health"] as const,
};

export function useHealth(enabled = true) {
  return useQuery({
    queryKey: healthKeys.status(),
    queryFn: fetchHealth,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
