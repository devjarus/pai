import { TrendingUpIcon, AlertCircleIcon, LoaderIcon, AlertTriangleIcon, ExternalLinkIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleToolCard } from "./CollapsibleToolCard";
import type { StockReport } from "@/types";

interface ToolStockReportProps {
  state: string;
  input?: { goal?: string; type?: string };
  output?: string;
}

function parseStockReport(output: string): StockReport | null {
  try {
    let data = typeof output === "string" ? JSON.parse(output) : output;
    if (typeof data === "string") data = JSON.parse(data);
    if (data.ticker && data.verdict && data.metrics) return data as StockReport;
    if (data.structuredResult) {
      const sr = typeof data.structuredResult === "string" ? JSON.parse(data.structuredResult) : data.structuredResult;
      if (sr.ticker && sr.verdict) return sr as StockReport;
    }
    return null;
  } catch {
    return null;
  }
}

const verdictLabels: Record<string, { label: string; color: string }> = {
  strong_buy: { label: "Strong Buy", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  buy: { label: "Buy", color: "bg-green-500/15 text-green-400 border-green-500/20" },
  hold: { label: "Hold", color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
  sell: { label: "Sell", color: "bg-red-500/15 text-red-400 border-red-500/20" },
  strong_sell: { label: "Strong Sell", color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

function MetricItem({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined || value === null) return null;
  return (
    <div>
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function ToolStockReport({ state, input, output }: ToolStockReportProps) {
  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Analyzing stock{input?.goal ? `...` : "..."}
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
          <span className="text-xs text-destructive">Stock analysis failed.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available" && output) {
    const report = parseStockReport(output);

    if (!report) {
      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <TrendingUpIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-foreground">Stock analysis completed. Check the Inbox for the full report.</span>
          </CardContent>
        </Card>
      );
    }

    const v = verdictLabels[report.verdict] ?? verdictLabels.hold!;
    const m = report.metrics;

    return (
      <CollapsibleToolCard
        icon={<TrendingUpIcon className="size-3.5 shrink-0 text-blue-400" />}
        label={
          <span className="flex items-center gap-1.5">
            📊 {report.ticker} — {report.company}
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">stock</Badge>
          </span>
        }
        defaultOpen
      >
        <div className="space-y-3">
          {/* Verdict + thesis */}
          <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Badge className={`${v.color} text-[10px] px-2 py-0.5`}>{v.label}</Badge>
              <span className="text-[10px] text-muted-foreground">Confidence: {report.confidence}%</span>
            </div>
            <p className="mt-1.5 text-xs text-foreground/80">{report.thesis}</p>
          </div>

          {/* Key metrics grid */}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            <MetricItem label="Price" value={`$${m.price}`} />
            <MetricItem label="P/E" value={m.pe} />
            <MetricItem label="Mkt Cap" value={m.marketCap} />
            <MetricItem label="YTD" value={m.ytdReturn} />
            <MetricItem label="52w High" value={m.high52w ? `$${m.high52w}` : undefined} />
            <MetricItem label="52w Low" value={m.low52w ? `$${m.low52w}` : undefined} />
            <MetricItem label="Rev Growth" value={m.revGrowth} />
            <MetricItem label="EPS" value={m.epsActual} />
          </div>

          {/* Catalysts */}
          {report.catalysts?.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Catalysts</p>
              <ul className="space-y-0.5">
                {report.catalysts.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-green-400/80">
                    <span className="mt-0.5 shrink-0">▲</span> {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {report.risks?.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Risks</p>
              <ul className="space-y-0.5">
                {report.risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-yellow-400/80">
                    <AlertTriangleIcon className="mt-0.5 size-2.5 shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sources */}
          {report.sources?.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Sources</p>
              <div className="flex flex-wrap gap-1.5">
                {report.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {s.title} <ExternalLinkIcon className="size-2" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleToolCard>
    );
  }

  return null;
}
