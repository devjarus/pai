import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getAuthStatus, getMe, logout as apiLogout } from "../api";
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [owner, setOwner] = useState<AuthOwner | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      if (status.setup) {
        setNeedsSetup(true);
        setIsAuthenticated(false);
        setOwner(null);
      } else if (status.authenticated) {
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
