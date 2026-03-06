import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { PlusIcon, MessageSquareIcon, BrainIcon, BookOpenIcon, CheckSquareIcon, CalendarIcon, ArrowDownNarrowWideIcon } from "lucide-react";
import Masonry, { ResponsiveMasonry } from "react-responsive-masonry";
import { Skeleton } from "@/components/ui/skeleton";
import { GridCard } from "@/components/GridCard";
import { useGridFeed, type GridCardType } from "@/hooks/use-grid-feed";
import { cn } from "@/lib/utils";

const ORDER_KEY = "pai-grid-order";
const PIN_KEY = "pai-grid-pins";
const SEEN_KEY = "pai-grid-seen";

function loadJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; } catch { return fallback; }
}

const typeLabels: { type: GridCardType | "all"; label: string }[] = [
  { type: "all", label: "All" },
  { type: "chat", label: "Chats" },
  { type: "research", label: "Research" },
  { type: "briefing", label: "Briefings" },
  { type: "memory", label: "Memories" },
  { type: "task", label: "Tasks" },
  { type: "knowledge", label: "Knowledge" },
];

export default function Grid() {
  const navigate = useNavigate();
  const { cards, allCards, isLoading, filters, setFilters } = useGridFeed();
  const [order, setOrder] = useState<string[]>(loadJson(ORDER_KEY, []));
  const [pins, setPins] = useState<Set<string>>(() => new Set(loadJson<string[]>(PIN_KEY, [])));
  const [seen, setSeen] = useState<Set<string>>(() => new Set(loadJson<string[]>(SEEN_KEY, [])));
  const [chronological, setChronological] = useState(() => localStorage.getItem("pai-grid-chrono") === "true");
  const [showNew, setShowNew] = useState(false);
  const newRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const orderedCards = useMemo(() => {
    if (chronological) {
      // Unseen automated cards first, then all by timestamp newest-first
      return [...cards].sort((a, b) => {
        const aUnseen = !seen.has(a.id) && a.automated ? 0 : 1;
        const bUnseen = !seen.has(b.id) && b.automated ? 0 : 1;
        if (aUnseen !== bUnseen) return aUnseen - bUnseen;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
    }
    const orderMap = new Map(order.map((id, i) => [id, i]));
    return [...cards].sort((a, b) => {
      const aPin = pins.has(a.id) ? 0 : 1;
      const bPin = pins.has(b.id) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      const aIdx = orderMap.get(a.id);
      const bIdx = orderMap.get(b.id);
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx !== undefined) return -1;
      if (bIdx !== undefined) return 1;
      return 0;
    });
  }, [cards, order, pins, chronological, seen]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedCards.map((c) => c.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(ids, oldIndex, newIndex);
    setOrder(newOrder);
    localStorage.setItem(ORDER_KEY, JSON.stringify(newOrder));
  }, [orderedCards]);

  const togglePin = useCallback((id: string) => {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(PIN_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const toggleFilter = useCallback((type: GridCardType | "all") => {
    if (type === "all") { setFilters(new Set()); return; }
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, [setFilters]);

  useEffect(() => {
    if (!allCards.length) return;
    const known = new Set(order);
    const newIds = allCards.map((c) => c.id).filter((id) => !known.has(id));
    if (newIds.length) {
      const updated = [...newIds, ...order];
      setOrder(updated);
      localStorage.setItem(ORDER_KEY, JSON.stringify(updated));
    }
  }, [allCards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    if (!showNew) return;
    const handler = (e: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(e.target as Node)) setShowNew(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNew]);

  const newItems = [
    { label: "New Chat", icon: MessageSquareIcon, action: () => navigate("/chat") },
    { label: "Add Memory", icon: BrainIcon, action: () => navigate("/memory") },
    { label: "Learn Knowledge", icon: BookOpenIcon, action: () => navigate("/knowledge?action=learn") },
    { label: "Add Task", icon: CheckSquareIcon, action: () => navigate("/tasks?action=add") },
    { label: "New Schedule", icon: CalendarIcon, action: () => navigate("/schedules?action=add") },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-card/50 px-4 py-2.5 md:px-6">
        <div className="flex flex-wrap gap-1.5 flex-1">
        {typeLabels.map(({ type, label }) => {
          const active = type === "all" ? filters.size === 0 : filters.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleFilter(type)}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? "border-primary/30 bg-primary/15 text-primary"
                  : "border-border/50 bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {label}
            </button>
          );
        })}

        <div className="group relative">
          <button
            onClick={() => { const next = !chronological; setChronological(next); localStorage.setItem("pai-grid-chrono", String(next)); }}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
              chronological
                ? "border-primary/30 bg-primary/15 text-primary"
                : "border-border/50 text-muted-foreground hover:bg-accent",
            )}
          >
            <ArrowDownNarrowWideIcon className="h-3 w-3" />
          </button>
          <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px] text-foreground shadow-lg border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity">
            Sort by newest
          </span>
        </div>
        </div>

        {/* Plus button */}
        <div className="relative" ref={newRef}>
          <button
            onClick={() => setShowNew(!showNew)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          {showNew && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-lg border border-border/50 bg-popover py-1 shadow-xl">
              {newItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => { setShowNew(false); item.action(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                >
                  <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Masonry */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {isLoading ? (
          <div className="columns-3 gap-3">
            {[140, 80, 180, 60, 120, 90].map((h, i) => (
              <Skeleton key={i} className="mb-3 w-full rounded-lg break-inside-avoid" style={{ height: h }} />
            ))}
          </div>
        ) : orderedCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p className="text-sm text-muted-foreground">No activity yet.</p>
            <p className="text-xs text-muted-foreground/60">Cards will appear here as you use pai.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedCards.map((c) => c.id)} strategy={rectSortingStrategy}>
              {(() => {
                const renderCard = (card: typeof orderedCards[0]) => (
                  <GridCard
                    key={card.id}
                    card={card}
                    pinned={pins.has(card.id)}
                    unseen={!seen.has(card.id) && card.automated}
                    onTogglePin={togglePin}
                    onOpen={markSeen}
                  />
                );
                return (
                  <ResponsiveMasonry columnsCountBreakPoints={{ 0: 2, 640: 3, 1024: 4 }}>
                    <Masonry gutter="20px" sequential>
                      {orderedCards.map(renderCard)}
                    </Masonry>
                  </ResponsiveMasonry>
                );
              })()}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
