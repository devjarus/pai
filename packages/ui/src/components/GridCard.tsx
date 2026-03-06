import { useNavigate } from "react-router-dom";
import {
  MessageSquareIcon,
  SearchIcon,
  NewspaperIcon,
  BrainIcon,
  CheckSquareIcon,
  BookOpenIcon,
  PinIcon,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { parseApiDate } from "@/lib/datetime";
import type { GridCard as GridCardData, GridCardType as CardType } from "@/hooks/use-grid-feed";

const typeConfig: Record<CardType, { icon: typeof BrainIcon; label: string; accent: string; badge: string }> = {
  chat:      { icon: MessageSquareIcon, label: "Chat",      accent: "border-l-blue-500",    badge: "text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10" },
  research:  { icon: SearchIcon,        label: "Research",  accent: "border-l-violet-500",  badge: "text-violet-700 dark:text-violet-400 bg-violet-100 dark:bg-violet-500/10" },
  briefing:  { icon: NewspaperIcon,     label: "Briefing",  accent: "border-l-amber-500",   badge: "text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10" },
  memory:    { icon: BrainIcon,         label: "Memory",    accent: "border-l-emerald-500", badge: "text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10" },
  task:      { icon: CheckSquareIcon,   label: "Task",      accent: "border-l-rose-500",    badge: "text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/10" },
  knowledge: { icon: BookOpenIcon,      label: "Knowledge", accent: "border-l-cyan-500",    badge: "text-cyan-700 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-500/10" },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseApiDate(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

interface GridCardProps {
  card: GridCardData;
  pinned?: boolean;
  unseen?: boolean;
  onTogglePin?: (id: string) => void;
  onOpen?: (id: string) => void;
}

export function GridCard({ card, pinned, unseen, onTogglePin, onOpen }: GridCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const cfg = typeConfig[card.type];
  const Icon = cfg.icon;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => {
    onOpen?.(card.id);
    navigate(card.navigateTo);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={cn(
        "group relative cursor-pointer rounded-xl border border-border/50 border-l-[3px] p-4 overflow-hidden transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-lg break-inside-avoid flex flex-col h-full w-full bg-card",
        cfg.accent,
        isDragging && "opacity-50 shadow-2xl z-50",
      )}
    >
      {/* Unseen indicator */}
      {unseen && (
        <div className="absolute top-0 right-0 w-0 h-0 border-t-[20px] border-t-primary border-l-[20px] border-l-transparent rounded-tr-xl" />
      )}

      {/* Title + type badge */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-foreground line-clamp-2">{card.title}</h3>
        <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0 mt-0.5", cfg.badge)}>
          <Icon className="h-2.5 w-2.5" />
          {cfg.label}
        </span>
      </div>

      {/* Subtitle + timestamp */}
      <div className="flex items-center justify-between gap-2 mb-2">
        {card.subtitle ? (
          <p className="text-[11px] text-muted-foreground truncate">{card.subtitle}</p>
        ) : <span />}
        <div className="flex items-center gap-1.5 shrink-0">
          {onTogglePin && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin(card.id); }}
              className={cn(
                "opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent",
                pinned && "opacity-100 text-primary",
              )}
              aria-label={pinned ? "Unpin" : "Pin"}
            >
              <PinIcon className="h-3 w-3" />
            </button>
          )}
          <span className="text-[10px] text-muted-foreground font-medium">{timeAgo(card.timestamp)}</span>
        </div>
      </div>

      {/* Divider */}
      {card.preview && <div className="border-t border-border/30 mb-2" />}

      {/* Preview */}
      {card.preview && (
        <div className="relative flex-1 overflow-hidden">
          <p className="text-[11px] text-foreground/90 leading-relaxed break-words">
            {card.preview}
          </p>
        </div>
      )}

      {/* Tags */}
      {card.tags && card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3 pt-2 border-t border-border/20">
          {card.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
