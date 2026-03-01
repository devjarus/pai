import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getConfig, updateConfig, browseDir } from "../api";
import { healthKeys } from "./use-health";

export const configKeys = {
  all: ["config"] as const,
  config: () => ["config", "data"] as const,
  browse: (path?: string) => ["config", "browse", path] as const,
};

export function useConfig() {
  return useQuery({
    queryKey: configKeys.config(),
    queryFn: () => getConfig(),
  });
}

export function useBrowseDir(path?: string, enabled = true) {
  return useQuery({
    queryKey: configKeys.browse(path),
    queryFn: () => browseDir(path),
    enabled,
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: {
      provider?: string;
      model?: string;
      baseUrl?: string;
      embedModel?: string;
      embedProvider?: string;
      apiKey?: string;
      dataDir?: string;
      timezone?: string;
      telegramToken?: string;
      telegramEnabled?: boolean;
      backgroundLearning?: boolean;
      briefingEnabled?: boolean;
      debugResearch?: boolean;
    }) => updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.all });
      // Re-check LLM connectivity after config change (e.g. new API key)
      queryClient.invalidateQueries({ queryKey: healthKeys.status() });
    },
  });
}
