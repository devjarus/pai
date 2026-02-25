import { useState, useEffect } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import Chat from "./pages/Chat";
import Memory from "./pages/Memory";
import Timeline from "./pages/Timeline";
import Settings from "./pages/Settings";
import Knowledge from "./pages/Knowledge";
import Tasks from "./pages/Tasks";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import { checkAuthRequired, getAuthToken, verifyToken, getStats } from "./api";

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="font-mono text-6xl font-bold tracking-tighter text-muted-foreground/30">
        404
      </div>
      <p className="text-sm text-muted-foreground">Page not found.</p>
      <Link
        to="/chat"
        className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Back to Chat
      </Link>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "login" | "onboarding">("loading");
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authRequired = await checkAuthRequired();
      if (cancelled) return;

      if (authRequired) {
        // Auth is required — check if we have a valid token
        const token = getAuthToken();
        if (!token) {
          setState("login");
          return;
        }

        const valid = await verifyToken(token);
        if (cancelled) return;

        if (!valid) {
          setState("login");
          return;
        }
      }

      // Auth passed (or not required) — check if onboarding is needed
      // Skip check if user already completed/skipped onboarding this session
      if (!localStorage.getItem("pai_onboarded")) {
        try {
          const stats = await getStats();
          if (cancelled) return;
          if (stats.beliefs.total === 0) {
            setState("onboarding");
            return;
          }
        } catch {
          // If stats fail, skip onboarding check and proceed
        }
      }

      if (cancelled) return;
      setState("ok");
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (state === "login") {
      navigate("/login", { replace: true });
    } else if (state === "onboarding") {
      navigate("/onboarding", { replace: true });
    }
  }, [state, navigate]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (state === "login" || state === "onboarding") return null;

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          element={
            <AuthGate>
              <Layout />
            </AuthGate>
          }
        >
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
