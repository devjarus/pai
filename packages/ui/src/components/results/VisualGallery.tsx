import { DownloadIcon, ImageIcon } from "lucide-react";
import type { ReportVisual } from "@/types";

interface VisualGalleryProps {
  visuals: ReportVisual[];
  title?: string;
}

export function VisualGallery({ visuals, title = "Charts" }: VisualGalleryProps) {
  if (visuals.length === 0) return null;

  const ordered = [...visuals].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {ordered.map((visual) => (
          <figure
            key={visual.artifactId}
            className="overflow-hidden rounded-lg border border-border/20 bg-card/30"
          >
            <img
              src={`/api/artifacts/${visual.artifactId}`}
              alt={visual.title}
              className="w-full bg-black/20 object-contain"
            />
            <figcaption className="space-y-1 border-t border-border/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">{visual.title}</div>
                <a
                  href={`/api/artifacts/${visual.artifactId}`}
                  download
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                </a>
              </div>
              {visual.caption && (
                <p className="text-xs text-muted-foreground">{visual.caption}</p>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
