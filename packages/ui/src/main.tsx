import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { registerSW } from "virtual:pwa-register";
import { ThemeProvider, useTheme, getEffectiveTheme } from "./context/ThemeContext";
import App from "./App";
import "./App.css";

// Auto-reload when a new service worker is installed so users always get
// the latest UI without needing a hard refresh.
registerSW({
  immediate: true,
  onNeedRefresh() {
    // New content available — reload immediately
    window.location.reload();
  },
});

function ThemedToaster() {
  const { theme } = useTheme();
  const effectiveTheme = getEffectiveTheme(theme);
  
  return (
    <Toaster
      theme={effectiveTheme}
      position="bottom-right"
      toastOptions={{
        style: {
          background: effectiveTheme === "dark" ? "#1a1a1a" : "#ffffff",
          border: effectiveTheme === "dark" ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.1)",
        },
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <TooltipProvider delayDuration={300}>
          <App />
          <ThemedToaster />
        </TooltipProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
