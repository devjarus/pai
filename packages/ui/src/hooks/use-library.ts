import { useQuery } from "@tanstack/react-query";
import { librarySearch, getLibraryStats, getFindings, getProfile, getInsights, getQualityScore } from "../api";

export const libraryKeys = {
  all: ["library"] as const,
  search: (q: string) => ["library", "search", q] as const,
  stats: () => ["library", "stats"] as const,
  findings: (watchId?: string) => ["library", "findings", watchId] as const,
};

export function useLibrarySearch(query: string) {
  return useQuery({
    queryKey: libraryKeys.search(query),
    queryFn: () => librarySearch(query),
    enabled: query.trim().length > 0,
  });
}

export function useLibraryStats() {
  return useQuery({
    queryKey: libraryKeys.stats(),
    queryFn: () => getLibraryStats(),
  });
}

export function useFindings(watchId?: string) {
  return useQuery({
    queryKey: libraryKeys.findings(watchId),
    queryFn: () => getFindings(watchId),
  });
}

export function useProfile() {
  return useQuery({
    queryKey: ["library", "profile"],
    queryFn: () => getProfile(),
    staleTime: 60_000, // profile doesn't change often
  });
}

export function useQualityScore() {
  return useQuery({
    queryKey: ["library", "quality"],
    queryFn: () => getQualityScore(),
    staleTime: 5 * 60_000,
  });
}

export function useInsights(watchId?: string) {
  return useQuery({
    queryKey: ["library", "insights", watchId ?? "all"],
    queryFn: () => getInsights(watchId),
    staleTime: 60_000,
  });
}
