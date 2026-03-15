import { useQuery } from "@tanstack/react-query";
import { librarySearch, getLibraryStats, getFindings } from "../api";

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
