import { SearchIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolMemoryRecallProps {
  state: string;
  input?: { query?: string };
  output?: string;
}

interface MemorySection {
  heading: string;
  items: string[];
}

function parseMemoryOutput(output: string): MemorySection[] {
  const sections: MemorySection[] = [];
  let currentSection: MemorySection | null = null;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect ## headers
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: headingMatch[1], items: [] };
      continue;
    }

    // Bullet items
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (bulletMatch && currentSection) {
      currentSection.items.push(bulletMatch[1]);
      continue;
    }

    // Non-bullet text: accumulate into current section or create default
    if (currentSection) {
      currentSection.items.push(trimmed);
    } else {
      currentSection = { heading: "", items: [trimmed] };
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}

export function ToolMemoryRecall({ state, input, output }: ToolMemoryRecallProps) {
  if (state === "input-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <SearchIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">
            Searching memory for{" "}
            <span className="font-medium text-foreground">
              {input?.query ? `"${input.query}"` : "..."}
            </span>
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Memory search failed.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    if (!output || !output.trim() || output.includes("No relevant memories")) {
      return (
        <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">No relevant memories found.</span>
          </CardContent>
        </Card>
      );
    }

    const sections = parseMemoryOutput(output);

    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              Memory recall{input?.query ? ` for "${input.query}"` : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {sections.map((section, i) => (
              <div key={i}>
                {section.heading && (
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.heading}
                  </div>
                )}
                {section.items.map((item, j) => (
                  <div
                    key={j}
                    className="border-l-2 border-border pl-2 text-xs leading-relaxed text-muted-foreground"
                  >
                    {item}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
