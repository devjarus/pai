import { defineRegistry } from "@json-render/react";
import { resultCatalog } from "./render-catalog";
import MarkdownContent from "../components/MarkdownContent";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Plane,
  FileText,
  BarChart2,
  Download,
} from "lucide-react";
import { useState } from "react";
import {
  buildAreaPath,
  buildDonutSegments,
  buildLinePath,
  buildLinePoints,
  formatChartValue,
  getChartBounds,
} from "./chart-utils";

const DEFAULT_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--primary)",
];

function ChartShell({
  title,
  children,
  footer,
}: {
  title?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-card/70 text-card-foreground">
      {title && <div className="px-4 pt-4 text-sm font-semibold text-foreground">{title}</div>}
      <div className="px-3 py-3">{children}</div>
      {footer && <div className="border-t border-border/40 px-4 py-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

function ChartEmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed border-border/50 px-4 py-6 text-sm text-muted-foreground">{message}</div>;
}

export const { registry, handlers, executeAction } = defineRegistry(resultCatalog, {
  components: {
    Section: ({ props, children }) => {
      const [open, setOpen] = useState(props.defaultOpen !== false);
      if (props.collapsible) {
        return (
          <div className="mb-5 overflow-hidden rounded-lg border border-border/50 bg-card/60">
            <button
              className="flex w-full items-center justify-between bg-card/40 px-4 py-3 text-left transition-colors hover:bg-accent/50"
              onClick={() => setOpen(!open)}
            >
              <div>
                <span className="font-semibold text-foreground">{props.title}</span>
                {props.subtitle && (
                  <span className="ml-2 text-sm text-muted-foreground">{props.subtitle}</span>
                )}
              </div>
              {open ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {open && <div className="px-4 py-4 space-y-3">{children}</div>}
          </div>
        );
      }
      return (
        <div className="mb-6">
          <h3 className="mb-3 font-semibold text-foreground">{props.title}</h3>
          {props.subtitle && <p className="mb-3 text-sm text-muted-foreground">{props.subtitle}</p>}
          {children}
        </div>
      );
    },

    Stack: ({ props, children }) => {
      const dir = props.direction === "horizontal" ? "flex-row" : "flex-col";
      const gap =
        props.gap === "sm" ? "gap-3" : props.gap === "lg" ? "gap-8" : "gap-5";
      const wrap = props.wrap ? "flex-wrap" : "";
      return <div className={`flex ${dir} ${gap} ${wrap}`}>{children}</div>;
    },

    Grid: ({ props, children }) => {
      const cols = props.columns ?? 3;
      const gap =
        props.gap === "sm" ? "gap-3" : props.gap === "lg" ? "gap-8" : "gap-5";
      const colClass =
        cols <= 2
          ? "md:grid-cols-2"
          : cols === 3
            ? "md:grid-cols-3"
            : "md:grid-cols-4";
      return (
        <div className={`grid grid-cols-2 ${colClass} ${gap}`}>{children}</div>
      );
    },

    MetricCard: ({ props }) => {
      const trendIcon =
        props.trend === "up" ? (
          <TrendingUp className="h-4 w-4 text-emerald-500" />
        ) : props.trend === "down" ? (
          <TrendingDown className="h-4 w-4 text-rose-500" />
        ) : props.trend === "neutral" ? (
          <Minus className="h-4 w-4 text-muted-foreground" />
        ) : null;
      return (
        <div className="rounded-lg border border-border/50 bg-card/60 p-3">
          <div className="mb-1 text-xs text-muted-foreground">{props.label}</div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">
              {props.value}
              {props.unit ? ` ${props.unit}` : ""}
            </span>
            {trendIcon}
          </div>
          {props.description && (
            <div className="mt-1 text-xs text-muted-foreground">{props.description}</div>
          )}
        </div>
      );
    },

    DataTable: ({ props }) => {
      // Normalize columns: LLMs sometimes send strings instead of {key,label} objects
      const columns = (props.columns ?? []).map((col, idx) => {
        if (typeof col === "string") return { key: col, label: col, align: null };
        // Handle missing key/label gracefully
        const key = col.key || col.label || `col${idx}`;
        const label = col.label || col.key || `Column ${idx + 1}`;
        return { ...col, key, label };
      });

      // Normalize rows: if row keys don't match column keys, try positional mapping
      const rows = (props.rows ?? []).map((row) => {
        if (!row || typeof row !== "object") return {} as Record<string, unknown>;
        // Check if any column key matches a row key
        const hasMatch = columns.some((col) => row[col.key] != null);
        if (hasMatch) return row;
        // Try case-insensitive match
        const rowKeys = Object.keys(row);
        const mapped: Record<string, unknown> = {};
        for (const col of columns) {
          const match = rowKeys.find((k) => k.toLowerCase() === col.key.toLowerCase());
          if (match) mapped[col.key] = row[match];
        }
        if (Object.keys(mapped).length > 0) return mapped;
        // Last resort: positional mapping (row values in order of columns)
        const values = Object.values(row);
        for (let i = 0; i < columns.length && i < values.length; i++) {
          mapped[columns[i].key] = values[i];
        }
        return Object.keys(mapped).length > 0 ? mapped : row;
      });

      return (
        <div className="overflow-x-auto rounded-lg border border-zinc-700/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-800/80 border-b border-zinc-700/50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 text-xs font-medium text-zinc-400 uppercase ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={`border-b border-zinc-700/30 ${
                    props.highlightFirst && i === 0
                      ? "bg-green-500/5 border-l-2 border-l-green-500"
                      : "hover:bg-zinc-800/30"
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-zinc-300 ${
                        col.align === "right"
                          ? "text-right"
                          : col.align === "center"
                            ? "text-center"
                            : "text-left"
                      }`}
                    >
                      {row[col.key] != null ? String(row[col.key]) : "\u2014"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },

    Badge: ({ props }) => {
      const variants: Record<string, string> = {
        success: "bg-green-500/15 text-green-400 border-green-500/30",
        warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
        danger: "bg-red-500/15 text-red-400 border-red-500/30",
        info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
        neutral: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
      };
      const v = variants[props.variant ?? "neutral"] ?? variants.neutral;
      return (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${v}`}
        >
          {props.text}
        </span>
      );
    },

    ProgressBar: ({ props }) => {
      const max = props.max ?? 100;
      const pct = Math.min(100, (props.value / max) * 100);
      const variants: Record<string, string> = {
        success: "bg-green-500",
        warning: "bg-yellow-500",
        danger: "bg-red-500",
        info: "bg-blue-500",
      };
      const bar = variants[props.variant ?? "info"] ?? variants.info;
      return (
        <div className="w-full">
          {props.label && (
            <div className="text-xs text-zinc-400 mb-1">
              {props.label} — {props.value}/{max}
            </div>
          )}
          <div className="h-2 bg-zinc-700/50 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${bar}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    },

    LineChart: ({ props }) => {
      const labels = props.labels ?? [];
      const values = props.values ?? [];
      if (labels.length === 0 || values.length === 0 || labels.length !== values.length) {
        return <ChartEmptyState message="Line chart data is unavailable." />;
      }

      const width = 360;
      const height = 220;
      const padding = 24;
      const chartBottom = height - 34;
      const points = buildLinePoints(values, width, chartBottom, padding, props.minValue, props.maxValue);
      const linePath = buildLinePath(points);
      const areaPath = props.showArea ? buildAreaPath(points, chartBottom, padding) : "";
      const bounds = getChartBounds(values, props.minValue, props.maxValue);
      const currentValue = values[values.length - 1];
      const stroke = props.color ?? DEFAULT_CHART_COLORS[0];
      const gridLines = Array.from({ length: 4 }, (_, index) => {
        const ratio = index / 3;
        return padding + ratio * (chartBottom - padding);
      });

      return (
        <ChartShell
          title={props.title}
          footer={
            <div className="flex items-center justify-between gap-2">
              <span>Min {formatChartValue(bounds.min, props.valuePrefix, props.valueSuffix)}</span>
              <span className="font-medium text-foreground">
                Latest {formatChartValue(currentValue, props.valuePrefix, props.valueSuffix)}
              </span>
              <span>Max {formatChartValue(bounds.max, props.valuePrefix, props.valueSuffix)}</span>
            </div>
          }
        >
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
            {gridLines.map((y, index) => (
              <line
                key={index}
                x1={padding}
                x2={width - padding}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeOpacity="0.9"
                strokeDasharray={index === gridLines.length - 1 ? undefined : "3 3"}
              />
            ))}
            {areaPath && <path d={areaPath} fill={stroke} opacity={0.14} />}
            <path d={linePath} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((point, index) => (
              <g key={labels[index]}>
                <circle cx={point.x} cy={point.y} r="4" fill={stroke} />
                <circle cx={point.x} cy={point.y} r="7" fill={stroke} opacity="0.18" />
                <text x={point.x} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                  {labels[index]}
                </text>
              </g>
            ))}
          </svg>
        </ChartShell>
      );
    },

    BarChart: ({ props }) => {
      const data = props.data ?? [];
      if (data.length === 0) {
        return <ChartEmptyState message="Bar chart data is unavailable." />;
      }

      const maxValue = props.maxValue ?? Math.max(...data.map((item) => item.value), 1);

      return (
        <ChartShell title={props.title}>
          <div className="flex items-end gap-3">
            {data.map((item, index) => {
              const height = Math.max(10, (Math.max(0, item.value) / Math.max(1, maxValue)) * 160);
              const color = item.color ?? DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length];
              return (
                <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="text-[11px] font-medium text-foreground/80">
                    {formatChartValue(item.value, props.valuePrefix, props.valueSuffix)}
                  </div>
                  <div className="flex h-40 w-full items-end justify-center">
                    <div
                      className="w-full max-w-16 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                      style={{ height: `${height}px`, backgroundColor: color }}
                    />
                  </div>
                  <div className="text-center text-[11px] text-muted-foreground">{item.label}</div>
                </div>
              );
            })}
          </div>
        </ChartShell>
      );
    },

    DonutChart: ({ props }) => {
      const data = props.data ?? [];
      if (data.length === 0) {
        return <ChartEmptyState message="Donut chart data is unavailable." />;
      }

      const radius = 44;
      const circumference = 2 * Math.PI * radius;
      const segments = buildDonutSegments(data, circumference);

      return (
        <ChartShell title={props.title}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="mx-auto shrink-0">
              <svg viewBox="0 0 120 120" className="h-40 w-40 -rotate-90">
                <circle
                  cx="60"
                  cy="60"
                  r={radius}
                  fill="none"
                  stroke="var(--border)"
                  strokeOpacity="0.8"
                  strokeWidth="16"
                />
                {segments.map((segment, index) => (
                  <circle
                    key={`${segment.label}-${index}`}
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={segment.color ?? DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length]}
                    strokeWidth="16"
                    strokeLinecap="round"
                    strokeDasharray={`${segment.dashLength} ${circumference}`}
                    strokeDashoffset={segment.dashOffset}
                  />
                ))}
                <g transform="rotate(90 60 60)">
                  <text x="60" y="54" textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">
                    {props.centerLabel ?? "Total"}
                  </text>
                  <text x="60" y="70" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--foreground)">
                    {formatChartValue(data.reduce((sum, item) => sum + item.value, 0), null, props.valueSuffix)}
                  </text>
                </g>
              </svg>
            </div>
            <div className="flex-1 space-y-2">
              {segments.map((segment, index) => (
                <div key={segment.label} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: segment.color ?? DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length] }}
                    />
                    <span className="text-sm text-foreground">{segment.label}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-foreground">
                      {formatChartValue(segment.value, null, props.valueSuffix)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{Math.round(segment.percentage * 100)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ChartShell>
      );
    },

    Heading: ({ props }) => {
      const sizes: Record<string, string> = {
        "1": "text-xl font-bold",
        "2": "text-lg font-semibold",
        "3": "text-base font-medium",
      };
      const cls = sizes[props.level ?? "2"] ?? sizes["2"];
      return <div className={`${cls} text-zinc-100 mb-2`}>{props.text}</div>;
    },

    Text: ({ props }) => {
      const variants: Record<string, string> = {
        body: "text-sm text-zinc-300",
        caption: "text-xs text-zinc-500",
        bold: "text-sm font-semibold text-zinc-200",
        muted: "text-sm text-zinc-500",
      };
      const cls = variants[props.variant ?? "body"] ?? variants.body;
      return <p className={cls}>{props.content}</p>;
    },

    Markdown: ({ props }) => <MarkdownContent content={props.content} />,

    BulletList: ({ props }) => {
      const icons: Record<string, React.ReactNode> = {
        bullet: <span className="text-zinc-500">&bull;</span>,
        check: (
          <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
        ),
        warning: (
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
        ),
        "arrow-up": (
          <ArrowUp className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
        ),
        "arrow-down": (
          <ArrowDown className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
        ),
      };
      const icon = icons[props.icon ?? "bullet"] ?? icons.bullet;
      const textColor =
        props.variant === "success"
          ? "text-green-400/80"
          : props.variant === "danger"
            ? "text-red-400/80"
            : props.variant === "warning"
              ? "text-yellow-400/80"
              : "text-zinc-300";
      return (
        <ul className="space-y-1.5">
          {props.items.map((item, i) => (
            <li key={i} className={`flex items-start gap-2 text-sm ${textColor}`}>
              {icon}
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    },

    LinkButton: ({ props }) => (
      <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
          props.variant === "primary"
            ? "bg-blue-600 text-white hover:bg-blue-500"
            : props.variant === "outline"
              ? "border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
              : "bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700"
        }`}
      >
        {props.icon === "external" && <ExternalLink className="w-3 h-3" />}
        {props.icon === "booking" && <Plane className="w-3 h-3" />}
        {props.icon === "source" && <FileText className="w-3 h-3" />}
        {props.icon === "chart" && <BarChart2 className="w-3 h-3" />}
        {props.text}
      </a>
    ),

    SourceList: ({ props }) => (
      <div className="flex flex-wrap gap-2 mt-2">
        {props.sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800/50 border border-zinc-700/50 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {s.title}
          </a>
        ))}
      </div>
    ),

    ChartImage: ({ props }) => (
      <div className="rounded-lg overflow-hidden border border-zinc-700/50">
        <img src={props.src} alt={props.alt} className="w-full" />
        {(props.caption || props.src) && (
          <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 px-3 py-2 bg-zinc-800/50">
            <span className="min-w-0 flex-1">{props.caption}</span>
            <a
              href={props.src}
              download
              className="shrink-0 text-zinc-400 transition-colors hover:text-zinc-200"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    ),

    FlightOption: ({ props }) => (
      <div
        className={`border rounded-lg p-3 ${
          props.score && props.score >= 80
            ? "border-green-500/30 bg-green-500/5"
            : "border-zinc-700/50 bg-zinc-800/30"
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Plane className="w-4 h-4 text-blue-400" />
            <span className="font-medium text-zinc-200">{props.airline}</span>
            {props.flightNo && (
              <span className="text-xs text-zinc-500">{props.flightNo}</span>
            )}
          </div>
          <span className="text-lg font-bold text-zinc-100">
            {props.price}
            {props.currency ? ` ${props.currency}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <span>
            {props.departure} &rarr; {props.arrival}
          </span>
          <span>{props.duration}</span>
          <span>
            {props.stops === 0
              ? "Nonstop"
              : `${props.stops} stop${props.stops > 1 ? "s" : ""}`}
          </span>
        </div>
        {(props.baggage || props.refundable !== null) && (
          <div className="flex gap-3 mt-2 text-xs text-zinc-500">
            {props.baggage && <span>{props.baggage}</span>}
            {props.refundable !== null && (
              <span>{props.refundable ? "Refundable" : "Non-refundable"}</span>
            )}
          </div>
        )}
        {props.score !== null && (
          <div className="mt-2 text-xs text-zinc-500">
            Score: {props.score}/100
            {props.scoreReason ? ` \u2014 ${props.scoreReason}` : ""}
          </div>
        )}
        {props.bookingUrl && (
          <a
            href={props.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          >
            Book <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    ),
  },

  actions: {
    open_link: async (params) => {
      if (params?.url && typeof params.url === "string") {
        window.open(params.url, "_blank", "noopener,noreferrer");
      }
    },
  },
});
