import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { OfflineBanner } from "./OfflineBanner";
import { MobileTabBar } from "./MobileTabBar";
import { useInboxAll } from "@/hooks/use-inbox";

const legacyNavItems = [
  { to: "/", label: "Home", icon: IconInbox },
  { to: "/programs", label: "Programs", icon: IconPrograms },
  { to: "/ask", label: "Ask", icon: IconChat },
  { to: "/memory", label: "Memory", icon: IconMemory },
  { to: "/settings", label: "Settings", icon: IconSettings },
];

const newNavItems = [
  { to: "/", label: "Briefs", icon: IconInbox },
  { to: "/programs", label: "Programs", icon: IconPrograms },
  { to: "/ask", label: "Ask", icon: IconChat },
  { to: "/memory", label: "Memory", icon: IconMemory },
  { to: "/settings", label: "Settings", icon: IconSettings },
];

const INBOX_SEEN_KEY = "pai-last-seen-briefing-id";

import { useNewUI } from "@/hooks/use-new-ui";

export default function Layout() {
  const location = useLocation();
  const { newUI, toggleNewUI } = useNewUI();

  // Shared inbox query — reuses cache with Inbox page, polls every 30 min
  const { data: inboxData } = useInboxAll();

  // Track last-seen briefing ID (persisted in localStorage)
  const [seenId, setSeenId] = useState(() => localStorage.getItem(INBOX_SEEN_KEY));

  const latestId = inboxData?.briefings?.[0]?.id ?? null;
  const hasNewBriefing = !!latestId && latestId !== seenId;

  // Mark briefing as seen when user visits Inbox
  useEffect(() => {
    if (location.pathname === "/" && latestId) {
      localStorage.setItem(INBOX_SEEN_KEY, latestId);
      setSeenId(latestId);
    }
  }, [location.pathname, latestId]);

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background">
      <div className="flex flex-1 overflow-hidden">
      {/* Desktop sidebar — hidden on mobile, replaced by bottom tab bar */}
      <nav className="hidden md:flex h-full w-14 flex-col items-center border-r border-border/40 bg-background py-4">
        {/* Branding */}
        <div className="mb-2 font-mono text-base font-bold tracking-tighter text-primary">
          pai
        </div>

        <Separator className="mx-2 mb-4 w-8 opacity-30" />

        {/* Nav icons */}
        <div className="flex flex-1 flex-col items-center gap-1">
          {(newUI ? newNavItems : legacyNavItems).map((item) => (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <div className="relative">
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    aria-label={item.label}
                    className={({ isActive }) =>
                      cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )
                    }
                  >
                    <item.icon />
                  </NavLink>
                  {item.to === "/" && hasNewBriefing && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background pointer-events-none" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* UI toggle pill */}
        <button
          onClick={() => { toggleNewUI(); window.location.reload(); }}
          className="mt-2 rounded-full border border-border/50 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {newUI ? "✨ New" : "Classic"}
        </button>
      </nav>

      {/* Main content — bottom padding on mobile to clear tab bar */}
      <main className="flex flex-1 flex-col overflow-hidden bg-card pb-14 md:pb-0">
        <OfflineBanner />
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <MobileTabBar hasNewBriefing={hasNewBriefing} />
      </div>
    </div>
  );
}

function IconInbox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconMemory() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconPrograms() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
