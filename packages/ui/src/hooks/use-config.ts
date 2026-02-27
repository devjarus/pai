import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getConfig, updateConfig, browseDir } from "../api";

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
      telegramToken?: string;
      telegramEnabled?: boolean;
    }) => updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.all });
    },
  });
}
