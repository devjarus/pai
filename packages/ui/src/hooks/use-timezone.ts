import { useConfig } from "./use-config";

/** Returns configured IANA timezone, or undefined to use browser local timezone. */
export function useAppTimezone(): string | undefined {
  const { data } = useConfig();
  return data?.timezone || undefined;
}
