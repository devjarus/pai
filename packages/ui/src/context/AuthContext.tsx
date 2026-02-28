import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { getAuthStatus, getMe, logout as apiLogout, refreshToken } from "../api";
import type { AuthOwner } from "../types";

interface AuthState {
  loading: boolean;
  needsSetup: boolean;
  isAuthenticated: boolean;
  owner: AuthOwner | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  needsSetup: false,
  isAuthenticated: false,
  owner: null,
  logout: async () => {},
  refresh: async () => {},
});

// Proactively refresh the access token before it expires (every 12 min; token lasts 15 min)
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [owner, setOwner] = useState<AuthOwner | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      if (status.setup) {
        setNeedsSetup(true);
        setIsAuthenticated(false);
        setOwner(null);
      } else if (status.authenticated) {
        try {
          const { owner: me } = await getMe();
          setOwner(me);
          setIsAuthenticated(true);
          setNeedsSetup(false);
        } catch {
          // getMe failed (e.g. token expired between status check and /me call)
          // Try refreshing the token and retry once
          try {
            await refreshToken();
            const { owner: me } = await getMe();
            setOwner(me);
            setIsAuthenticated(true);
            setNeedsSetup(false);
          } catch {
            setIsAuthenticated(false);
            setOwner(null);
          }
        }
      } else {
        // Not authenticated — try refreshing in case the access token expired
        // but refresh token is still valid
        try {
          await refreshToken();
          const retryStatus = await getAuthStatus();
          if (retryStatus.authenticated) {
            const { owner: me } = await getMe();
            setOwner(me);
            setIsAuthenticated(true);
            setNeedsSetup(false);
          } else {
            setIsAuthenticated(false);
            setOwner(null);
            setNeedsSetup(false);
          }
        } catch {
          setIsAuthenticated(false);
          setOwner(null);
          setNeedsSetup(false);
        }
      }
    } catch {
      setIsAuthenticated(false);
      setOwner(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Proactive token refresh — keep the access token fresh so API calls never hit 401
  useEffect(() => {
    if (!isAuthenticated) {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }
    refreshTimerRef.current = setInterval(() => {
      refreshToken().catch(() => {
        // If refresh fails, the next API call will trigger reactive refresh
      });
    }, TOKEN_REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [isAuthenticated]);

  const logout = useCallback(async () => {
    await apiLogout();
    setIsAuthenticated(false);
    setOwner(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, needsSetup, isAuthenticated, owner, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
