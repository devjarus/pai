import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./App.css";

// Auto-reload when a new service worker is installed so users always get
// the latest UI without needing a hard refresh.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#1a1a1a",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#e5e5e5",
            },
          }}
        />
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
);
