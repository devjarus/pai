import { useState, useEffect, useRef } from "react";
import { WifiOffIcon } from "lucide-react";
import { getAuthToken } from "../api";

const PING_INTERVAL = 10_000;

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const ping = async () => {
      try {
        const token = getAuthToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/health", {
          method: "GET",
          cache: "no-store",
          headers,
          signal: AbortSignal.timeout(5000),
        });
        if (mountedRef.current) setOffline(!res.ok);
      } catch {
        if (mountedRef.current) setOffline(true);
      }
    };

    // Don't ping immediately on mount — the app loads fine if we're here
    const interval = setInterval(ping, PING_INTERVAL);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-400">
      <WifiOffIcon className="h-3.5 w-3.5 shrink-0" />
      <span>Server is offline. Reconnecting...</span>
    </div>
  );
}
