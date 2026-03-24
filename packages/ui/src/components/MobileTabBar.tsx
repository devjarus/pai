import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useJobs } from "@/hooks/use-jobs";

interface MobileTabBarProps {
  hasNewBriefing: boolean;
}

const primaryTabs = [
  { to: "/", label: "Home", icon: TabIconHome },
  { to: "/watches", label: "Watches", icon: TabIconPrograms },
  { to: "/ask", label: "Chat", icon: TabIconChat },
  { to: "/jobs", label: "Activity", icon: TabIconActivity },
  { to: "/library", label: "Library", icon: TabIconMemory },
] as const;

export function MobileTabBar({ hasNewBriefing }: MobileTabBarProps) {
  const { data: jobsData } = useJobs();
  const activeJobCount = (jobsData?.jobs ?? []).filter((j: { status: string }) => j.status === "running" || j.status === "pending").length;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border/40 bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex items-stretch">
        {primaryTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              cn(
                "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground active:text-foreground",
              )
            }
          >
            <tab.icon />
            <span>{tab.label}</span>
            {tab.to === "/" && hasNewBriefing && (
              <span className="absolute right-1/4 top-1.5 h-1.5 w-1.5 rounded-full bg-primary pointer-events-none" />
            )}
            {tab.to === "/jobs" && activeJobCount > 0 && (
              <span className="absolute right-1/4 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 pointer-events-none animate-pulse" />
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function TabIconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function TabIconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TabIconMemory() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function TabIconPrograms() {
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

function TabIconActivity() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
