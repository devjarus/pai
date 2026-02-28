import { lazy, Suspense } from "react";
import { Routes, Route, Link, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client";

const ReactQueryDevtools = lazy(() =>
  import("@tanstack/react-query-devtools").then((mod) => ({
    default: mod.ReactQueryDevtools,
  }))
);
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Chat from "./pages/Chat";
import Memory from "./pages/Memory";
import Timeline from "./pages/Timeline";
import Settings from "./pages/Settings";
import Knowledge from "./pages/Knowledge";
import Tasks from "./pages/Tasks";
import Inbox from "./pages/Inbox";
import Jobs from "./pages/Jobs";
import Schedules from "./pages/Schedules";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Onboarding from "./pages/Onboarding";

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="font-mono text-6xl font-bold tracking-tighter text-muted-foreground/30">404</div>
      <p className="text-sm text-muted-foreground">Page not found.</p>
      <Link to="/" className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
        Back to Home
      </Link>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, needsSetup, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<AuthGate><Layout /></AuthGate>}>
            <Route path="/" element={<ErrorBoundary><Inbox /></ErrorBoundary>} />
            <Route path="/inbox/:id" element={<ErrorBoundary><Inbox /></ErrorBoundary>} />
            <Route path="/chat" element={<ErrorBoundary><Chat /></ErrorBoundary>} />
            <Route path="/memory" element={<ErrorBoundary><Memory /></ErrorBoundary>} />
            <Route path="/timeline" element={<ErrorBoundary><Timeline /></ErrorBoundary>} />
            <Route path="/knowledge" element={<ErrorBoundary><Knowledge /></ErrorBoundary>} />
            <Route path="/tasks" element={<ErrorBoundary><Tasks /></ErrorBoundary>} />
            <Route path="/jobs" element={<ErrorBoundary><Jobs /></ErrorBoundary>} />
            <Route path="/schedules" element={<ErrorBoundary><Schedules /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        </Suspense>
      )}
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
