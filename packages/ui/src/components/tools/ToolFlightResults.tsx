import { PlaneIcon, AlertCircleIcon, LoaderIcon, ExternalLinkIcon, CheckIcon, XIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleToolCard } from "./CollapsibleToolCard";
import type { FlightReport, FlightOption } from "@/types";

interface ToolFlightResultsProps {
  state: string;
  input?: { goal?: string; type?: string };
  output?: string;
}

function parseFlightReport(output: string): FlightReport | null {
  try {
    let data = typeof output === "string" ? JSON.parse(output) : output;
    if (typeof data === "string") data = JSON.parse(data);
    // Could be the report directly, or wrapped in structuredResult
    if (data.query && Array.isArray(data.options)) return data as FlightReport;
    if (data.structuredResult) {
      const sr = typeof data.structuredResult === "string" ? JSON.parse(data.structuredResult) : data.structuredResult;
      if (sr.query && Array.isArray(sr.options)) return sr as FlightReport;
    }
    return null;
  } catch {
    return null;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function FlightOptionCard({ option, rank }: { option: FlightOption; rank: number }) {
  const isBest = rank === 0;

  return (
    <div className={`rounded-lg border p-3 ${isBest ? "border-green-500/30 bg-green-500/5" : "border-border/30 bg-muted/20"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{option.airline} {option.flightNo}</span>
            {isBest && <Badge className="bg-green-500/15 text-green-400 text-[9px] px-1.5 py-0">Best</Badge>}
            {option.stops === 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">Nonstop</Badge>}
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            <span>{formatDate(option.departure)} {formatTime(option.departure)}</span>
            <span className="mx-1.5">→</span>
            <span>{formatDate(option.arrival)} {formatTime(option.arrival)}</span>
            <span className="ml-2 text-muted-foreground/60">({option.duration})</span>
          </div>
          {option.returnDeparture && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              <span>{formatDate(option.returnDeparture)} {formatTime(option.returnDeparture)}</span>
              <span className="mx-1.5">→</span>
              <span>{formatDate(option.returnArrival ?? "")} {formatTime(option.returnArrival ?? "")}</span>
              <span className="ml-2 text-muted-foreground/60">({option.returnDuration})</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {option.baggage && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <CheckIcon className="size-2.5 text-green-400" /> {option.baggage}
              </span>
            )}
            {option.refundable !== undefined && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                {option.refundable
                  ? <><CheckIcon className="size-2.5 text-green-400" /> Refundable</>
                  : <><XIcon className="size-2.5 text-red-400" /> Non-refundable</>
                }
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground/70">Score: {option.score}/100 — {option.scoreReason}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-foreground">${option.price.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">{option.currency}</p>
          {option.bookingUrl && (
            <a
              href={option.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Book <ExternalLinkIcon className="size-2.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function ToolFlightResults({ state, input, output }: ToolFlightResultsProps) {
  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Searching for flights{input?.goal ? `...` : "..."}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Flight search failed.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available" && output) {
    const report = parseFlightReport(output);

    if (!report || report.options.length === 0) {
      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <PlaneIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-foreground">No flights found matching your criteria.</span>
          </CardContent>
        </Card>
      );
    }

    const { query, options } = report;
    const sorted = [...options].sort((a, b) => b.score - a.score);

    return (
      <CollapsibleToolCard
        icon={<PlaneIcon className="size-3.5 shrink-0 text-blue-400" />}
        label={
          <span className="flex items-center gap-1.5">
            ✈ {query.origin} → {query.destination} ({sorted.length} options)
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">flights</Badge>
          </span>
        }
        defaultOpen
      >
        <div className="flex flex-col gap-2">
          {sorted.slice(0, 5).map((opt, i) => (
            <FlightOptionCard key={`${opt.flightNo}-${i}`} option={opt} rank={i} />
          ))}
          {report.disclaimer && (
            <p className="text-[9px] text-muted-foreground/50 italic">{report.disclaimer}</p>
          )}
        </div>
      </CollapsibleToolCard>
    );
  }

  return null;
}
