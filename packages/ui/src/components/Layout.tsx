import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { OfflineBanner } from "./OfflineBanner";
import { MobileTabBar } from "./MobileTabBar";
import { PaiLogo } from "./PaiLogo";
import { useInboxAll } from "@/hooks/use-inbox";
import { useJobs } from "@/hooks/use-jobs";

const navItems = [
  { to: "/", label: "Home", icon: IconHome },
  { to: "/watches", label: "Watches", icon: IconPrograms },
  { to: "/ask", label: "Chat", icon: IconChat },
  { to: "/library", label: "Library", icon: IconMemory },
  { to: "/settings", label: "Settings", icon: IconSettings },
];

const DIGEST_SEEN_KEY = "pai-last-seen-digest-id";

export default function Layout() {
  const location = useLocation();

  // Shared inbox query — reuses cache with Inbox page, polls every 30 min
  const { data: inboxData } = useInboxAll();

  // Track last-seen briefing ID (persisted in localStorage)
  const [seenId, setSeenId] = useState(() => localStorage.getItem(DIGEST_SEEN_KEY));

  const latestId = inboxData?.briefings?.[0]?.id ?? null;
  const hasNewBriefing = !!latestId && latestId !== seenId;

  const { data: jobsData } = useJobs();
  const activeJobs = (jobsData?.jobs ?? []).filter((j: { status: string }) => j.status === "running" || j.status === "pending");
  const hasActiveJobs = activeJobs.length > 0;

  // Mark briefing as seen when user visits Digests
  useEffect(() => {
    if (location.pathname === "/" && latestId) {
      localStorage.setItem(DIGEST_SEEN_KEY, latestId);
      setSeenId(latestId);
    }
  }, [location.pathname, latestId]);

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background">
      {/* Desktop sidebar — hidden on mobile, replaced by bottom tab bar */}
      <nav className="hidden md:flex h-full w-14 flex-col items-center border-r border-border/40 bg-background py-4">
        {/* Branding */}
        <div className="mb-2">
          <PaiLogo size={28} />
        </div>

        <Separator className="mx-2 mb-4 w-8 opacity-30" />

        {/* Nav icons */}
        <div className="flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => (
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

        {/* Global activity indicator — visible when jobs are running */}
        {hasActiveJobs && (
          <Tooltip>
            <TooltipTrigger asChild>
              <NavLink
                to="/jobs"
                aria-label="Active jobs"
                className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
              >
                <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" opacity="0.3" />
                  <path d="M12 2v4" />
                </svg>
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {activeJobs.length} job{activeJobs.length !== 1 ? "s" : ""} running
            </TooltipContent>
          </Tooltip>
        )}
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
  );
}

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
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
