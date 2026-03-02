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
} from "lucide-react";
import { useState } from "react";

export const { registry, handlers, executeAction } = defineRegistry(resultCatalog, {
  components: {
    Section: ({ props, children }) => {
      const [open, setOpen] = useState(props.defaultOpen !== false);
      if (props.collapsible) {
        return (
          <div className="border border-zinc-700/50 rounded-lg mb-3 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 text-left"
              onClick={() => setOpen(!open)}
            >
              <div>
                <span className="font-semibold text-zinc-100">{props.title}</span>
                {props.subtitle && (
                  <span className="ml-2 text-sm text-zinc-400">{props.subtitle}</span>
                )}
              </div>
              {open ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            {open && <div className="px-4 py-3">{children}</div>}
          </div>
        );
      }
      return (
        <div className="mb-4">
          <h3 className="font-semibold text-zinc-100 mb-2">{props.title}</h3>
          {props.subtitle && <p className="text-sm text-zinc-400 mb-2">{props.subtitle}</p>}
          {children}
        </div>
      );
    },

    Stack: ({ props, children }) => {
      const dir = props.direction === "horizontal" ? "flex-row" : "flex-col";
      const gap =
        props.gap === "sm" ? "gap-2" : props.gap === "lg" ? "gap-6" : "gap-4";
      const wrap = props.wrap ? "flex-wrap" : "";
      return <div className={`flex ${dir} ${gap} ${wrap}`}>{children}</div>;
    },

    Grid: ({ props, children }) => {
      const cols = props.columns ?? 3;
      const gap =
        props.gap === "sm" ? "gap-2" : props.gap === "lg" ? "gap-6" : "gap-4";
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
          <TrendingUp className="w-4 h-4 text-green-400" />
        ) : props.trend === "down" ? (
          <TrendingDown className="w-4 h-4 text-red-400" />
        ) : props.trend === "neutral" ? (
          <Minus className="w-4 h-4 text-zinc-400" />
        ) : null;
      return (
        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3">
          <div className="text-xs text-zinc-400 mb-1">{props.label}</div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-zinc-100">
              {props.value}
              {props.unit ? ` ${props.unit}` : ""}
            </span>
            {trendIcon}
          </div>
          {props.description && (
            <div className="text-xs text-zinc-500 mt-1">{props.description}</div>
          )}
        </div>
      );
    },

    DataTable: ({ props }) => (
      <div className="overflow-x-auto rounded-lg border border-zinc-700/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/80 border-b border-zinc-700/50">
              {props.columns.map((col) => (
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
            {props.rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-zinc-700/30 ${
                  props.highlightFirst && i === 0
                    ? "bg-green-500/5 border-l-2 border-l-green-500"
                    : "hover:bg-zinc-800/30"
                }`}
              >
                {props.columns.map((col) => (
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
                    {row[col.key] ?? "\u2014"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),

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
        {props.caption && (
          <div className="text-xs text-zinc-500 px-3 py-2 bg-zinc-800/50">
            {props.caption}
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
