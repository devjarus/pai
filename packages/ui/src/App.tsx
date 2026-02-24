import { Routes, Route, Navigate, Link } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import Chat from "./pages/Chat";
import Memory from "./pages/Memory";
import Timeline from "./pages/Timeline";
import Settings from "./pages/Settings";
import Knowledge from "./pages/Knowledge";

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

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
