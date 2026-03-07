import {
  BracesIcon,
  DownloadIcon,
  FileIcon,
  ImageIcon,
  TableIcon,
} from "lucide-react";

interface ArtifactItem {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

interface ArtifactGalleryProps {
  artifacts: ArtifactItem[];
  title?: string;
}

function formatSize(bytes?: number): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getArtifactIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType === "text/csv") return TableIcon;
  if (mimeType === "application/json") return BracesIcon;
  return FileIcon;
}

export function ArtifactGallery({ artifacts, title = "Artifacts" }: ArtifactGalleryProps) {
  if (artifacts.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2">
        {artifacts.map((artifact) => {
          const Icon = getArtifactIcon(artifact.mimeType);
          const isImage = artifact.mimeType.startsWith("image/");
          const size = formatSize(artifact.size);

          return (
            <div
              key={artifact.id}
              className="rounded-lg border border-border/20 bg-card/30 p-3"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                  {artifact.name}
                </span>
                {size && (
                  <span className="text-[10px] text-muted-foreground/60">{size}</span>
                )}
                <a
                  href={`/api/artifacts/${artifact.id}`}
                  download={artifact.name}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <DownloadIcon className="h-3 w-3" />
                </a>
              </div>
              {isImage && (
                <img
                  src={`/api/artifacts/${artifact.id}`}
                  alt={artifact.name}
                  className="mt-2 max-h-56 w-full rounded border border-border/20 bg-black/10 object-contain"
                  loading="lazy"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
