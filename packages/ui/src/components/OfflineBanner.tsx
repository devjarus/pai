import { useState, useEffect, useRef } from "react";
import { WifiOffIcon } from "lucide-react";

const PING_INTERVAL = 10_000;
const PING_TIMEOUT = 15_000;
const FAILURES_BEFORE_OFFLINE = 2;

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const mountedRef = useRef(true);
  const failCountRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    const ping = async () => {
      try {
        const res = await fetch("/api/health", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          signal: AbortSignal.timeout(PING_TIMEOUT),
        });
        if (mountedRef.current) {
          if (res.ok) {
            failCountRef.current = 0;
            setOffline(false);
          } else {
            failCountRef.current++;
            if (failCountRef.current >= FAILURES_BEFORE_OFFLINE) setOffline(true);
          }
        }
      } catch {
        if (mountedRef.current) {
          failCountRef.current++;
          if (failCountRef.current >= FAILURES_BEFORE_OFFLINE) setOffline(true);
        }
      }
    };

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
