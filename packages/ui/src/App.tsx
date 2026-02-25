import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Chat from "./pages/Chat";
import Memory from "./pages/Memory";
import Timeline from "./pages/Timeline";
import Settings from "./pages/Settings";
import Knowledge from "./pages/Knowledge";
import Tasks from "./pages/Tasks";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Onboarding from "./pages/Onboarding";

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="font-mono text-6xl font-bold tracking-tighter text-muted-foreground/30">404</div>
      <p className="text-sm text-muted-foreground">Page not found.</p>
      <Link to="/chat" className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
        Back to Chat
      </Link>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, needsSetup, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (needsSetup) {
    navigate("/setup", { replace: true });
    return null;
  }

  if (!isAuthenticated) {
    navigate("/login", { replace: true });
    return null;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<AuthGate><Layout /></AuthGate>}>
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
      </AuthProvider>
    </ErrorBoundary>
  );
}
