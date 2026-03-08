/**
 * Convert a json-render spec tree to static HTML with inline CSS.
 * Works in both browser and Node.js — no DOM or `window` dependency.
 *
 * Usage:
 *   specToStaticHtml(spec)                          // default: image src unchanged
 *   specToStaticHtml(spec, { resolveImageSrc })     // custom resolver (e.g. base64 data URIs)
 */
import {
  buildLinePoints,
  buildLinePath,
  buildAreaPath,
  buildDonutSegments,
  formatChartValue,
  getChartBounds,
} from "./chart-utils.js";

interface JsonRenderElement {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
}

interface JsonRenderSpec {
  root: string;
  elements: Record<string, JsonRenderElement>;
}

export interface SpecToHtmlOptions {
  /** Resolve an image src (e.g. `/api/artifacts/xyz`) to an absolute URL or data URI. */
  resolveImageSrc?: (src: string) => string;
}

const PRINT_CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#4f46e5",
];

const BADGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  success: { bg: "#dcfce7", text: "#166534", border: "#bbf7d0" },
  warning: { bg: "#fef9c3", text: "#854d0e", border: "#fde68a" },
  danger: { bg: "#fee2e2", text: "#991b1b", border: "#fecaca" },
  info: { bg: "#dbeafe", text: "#1e40af", border: "#bfdbfe" },
  neutral: { bg: "#f3f4f6", text: "#374151", border: "#e5e7eb" },
};

const PROGRESS_COLORS: Record<string, string> = {
  success: "#22c55e",
  warning: "#eab308",
  danger: "#ef4444",
  info: "#3b82f6",
};

function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal markdown-to-HTML for the Markdown component (no external dependency) */
function simpleMarkdownToHtml(md: string): string {
  let html = esc(md);
  // Headers
  html = html.replace(/^#{3}\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^#{2}\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^#{1}\s+(.+)$/gm, "<h2>$1</h2>");
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#2563eb">$1</a>');
  // Line breaks → paragraphs
  html = html.replace(/\n{2,}/g, "</p><p>");
  html = `<p>${html}</p>`;
  // List items
  html = html.replace(/<p>[-*]\s+/g, "<li>");
  return html;
}

function renderElement(id: string, spec: JsonRenderSpec, opts: SpecToHtmlOptions): string {
  const el = spec.elements[id];
  if (!el) return "";
  const props = (el.props ?? {}) as Record<string, unknown>;
  const childrenHtml = (el.children ?? []).map((cid) => renderElement(cid, spec, opts)).join("\n");
  const resolve = opts.resolveImageSrc ?? ((s: string) => s);

  switch (el.type) {
    case "Section": {
      const title = esc(props.title);
      const subtitle = props.subtitle ? `<p style="color:var(--muted, #6b7280);font-size:0.9em;margin:4px 0 12px">${esc(props.subtitle)}</p>` : "";
      return `<div style="margin-bottom:24px">
        <h3 style="font-size:1.1em;font-weight:600;border-bottom:1px solid var(--border, #e5e7eb);padding-bottom:6px;margin-bottom:8px">${title}</h3>
        ${subtitle}
        ${childrenHtml}
      </div>`;
    }

    case "Stack": {
      const dir = props.direction === "horizontal" ? "row" : "column";
      const gap = props.gap === "sm" ? "12px" : props.gap === "lg" ? "32px" : "20px";
      return `<div style="display:flex;flex-direction:${dir};gap:${gap};${props.wrap ? "flex-wrap:wrap;" : ""}">${childrenHtml}</div>`;
    }

    case "Grid": {
      const cols = Number(props.columns) || 3;
      const gap = props.gap === "sm" ? "12px" : props.gap === "lg" ? "32px" : "20px";
      return `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:${gap}">${childrenHtml}</div>`;
    }

    case "MetricCard": {
      const trend = props.trend === "up" ? '<span style="color:#16a34a;margin-left:6px">&#x2191;</span>'
        : props.trend === "down" ? '<span style="color:#dc2626;margin-left:6px">&#x2193;</span>'
          : props.trend === "neutral" ? '<span style="color:var(--muted, #6b7280);margin-left:6px">&#x2212;</span>'
            : "";
      const unit = props.unit ? ` <span style="font-size:0.75em;font-weight:400;color:var(--muted, #6b7280)">${esc(props.unit)}</span>` : "";
      const desc = props.description ? `<div style="font-size:0.75em;color:var(--muted, #6b7280);margin-top:4px">${esc(props.description)}</div>` : "";
      return `<div style="border:1px solid var(--border, #e5e7eb);border-radius:8px;padding:12px;background:var(--card-bg, #fafafa)">
        <div style="font-size:0.75em;color:var(--muted, #6b7280);margin-bottom:4px">${esc(props.label)}</div>
        <div style="font-size:1.25em;font-weight:700;color:var(--fg, #1a1a1a)">${esc(props.value)}${unit}${trend}</div>
        ${desc}
      </div>`;
    }

    case "DataTable": {
      const columns = ((props.columns ?? []) as Array<unknown>).map((col, idx) => {
        if (typeof col === "string") return { key: col, label: col, align: null };
        const c = col as Record<string, unknown>;
        const key = String(c.key || c.label || `col${idx}`);
        const label = String(c.label || c.key || `Column ${idx + 1}`);
        return { key, label, align: c.align as string | null };
      });
      const rows = (props.rows ?? []) as Array<Record<string, unknown>>;

      const thCells = columns.map((c) => {
        const align = c.align === "right" ? "text-align:right" : c.align === "center" ? "text-align:center" : "text-align:left";
        return `<th style="padding:8px 10px;font-weight:600;font-size:0.85em;border-bottom:2px solid var(--accent, #2563eb);background:var(--accent-bg, #eff6ff);${align}">${esc(c.label)}</th>`;
      }).join("");

      const bodyRows = rows.map((row, ri) => {
        const cells = columns.map((c) => {
          const align = c.align === "right" ? "text-align:right" : c.align === "center" ? "text-align:center" : "text-align:left";
          const val = row[c.key] != null ? String(row[c.key]) : "\u2014";
          return `<td style="padding:6px 10px;border-bottom:1px solid var(--border, #e5e7eb);${align}">${esc(val)}</td>`;
        }).join("");
        const bg = ri % 2 === 1 ? "background:var(--card-bg, #f9fafb);" : "";
        return `<tr style="${bg}">${cells}</tr>`;
      }).join("");

      return `<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:0.9em">
        <thead><tr>${thCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>`;
    }

    case "Badge": {
      const variant = String(props.variant ?? "neutral");
      const colors = BADGE_COLORS[variant] ?? BADGE_COLORS.neutral!;
      return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.8em;font-weight:500;background:${colors!.bg};color:${colors!.text};border:1px solid ${colors!.border}">${esc(props.text)}</span>`;
    }

    case "ProgressBar": {
      const max = Number(props.max) || 100;
      const value = Number(props.value) || 0;
      const pct = Math.min(100, (value / max) * 100);
      const variant = String(props.variant ?? "info");
      const color = PROGRESS_COLORS[variant] ?? PROGRESS_COLORS.info;
      const label = props.label ? `<div style="font-size:0.8em;color:var(--muted, #6b7280);margin-bottom:4px">${esc(props.label)} \u2014 ${value}/${max}</div>` : "";
      return `<div>${label}<div style="height:8px;background:var(--border, #e5e7eb);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color};border-radius:4px"></div></div></div>`;
    }

    case "LineChart": {
      const labels = (props.labels ?? []) as string[];
      const values = (props.values ?? []) as number[];
      if (labels.length === 0 || values.length === 0 || labels.length !== values.length) {
        return `<div style="padding:16px;border:1px dashed #d1d5db;border-radius:8px;color:#6b7280;font-size:0.9em">Line chart data unavailable.</div>`;
      }
      const width = 360;
      const height = 220;
      const padding = 24;
      const chartBottom = height - 34;
      const points = buildLinePoints(values, width, chartBottom, padding, props.minValue as number | null, props.maxValue as number | null);
      const linePath = buildLinePath(points);
      const stroke = String(props.color ?? PRINT_CHART_COLORS[0]);
      const bounds = getChartBounds(values, props.minValue as number | null, props.maxValue as number | null);
      const currentValue = values[values.length - 1]!;

      const gridLines = Array.from({ length: 4 }, (_, i) => padding + (i / 3) * (chartBottom - padding));
      const gridSvg = gridLines.map((y, i) =>
        `<line x1="${padding}" x2="${width - padding}" y1="${y}" y2="${y}" stroke="var(--border, #e5e7eb)" stroke-opacity="0.9" ${i < gridLines.length - 1 ? 'stroke-dasharray="3 3"' : ""}/>`
      ).join("");

      const areaPath = props.showArea ? buildAreaPath(points, chartBottom, padding) : "";
      const areaSvg = areaPath ? `<path d="${areaPath}" fill="${stroke}" opacity="0.12"/>` : "";

      const pointsSvg = points.map((p, i) =>
        `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${stroke}"/>
         <text x="${p.x}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--muted, #6b7280)">${esc(labels[i])}</text>`
      ).join("");

      const title = props.title ? `<div style="font-weight:600;font-size:0.9em;margin-bottom:8px">${esc(props.title)}</div>` : "";
      const footer = `<div style="display:flex;justify-content:space-between;font-size:0.75em;color:var(--muted, #6b7280);margin-top:4px;padding:4px 0;border-top:1px solid var(--border, #e5e7eb)">
        <span>Min ${formatChartValue(bounds.min, props.valuePrefix as string | null, props.valueSuffix as string | null)}</span>
        <span style="font-weight:600;color:var(--fg, #1a1a1a)">Latest ${formatChartValue(currentValue, props.valuePrefix as string | null, props.valueSuffix as string | null)}</span>
        <span>Max ${formatChartValue(bounds.max, props.valuePrefix as string | null, props.valueSuffix as string | null)}</span>
      </div>`;

      return `<div style="border:1px solid var(--border, #e5e7eb);border-radius:8px;overflow:hidden;margin:12px 0">
        ${title ? `<div style="padding:12px 12px 0">${title}</div>` : ""}
        <div style="padding:8px">
          <svg viewBox="0 0 ${width} ${height}" style="width:100%">
            ${gridSvg}
            ${areaSvg}
            <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            ${pointsSvg}
          </svg>
        </div>
        <div style="padding:0 12px 8px">${footer}</div>
      </div>`;
    }

    case "BarChart": {
      const data = (props.data ?? []) as Array<{ label: string; value: number; color?: string | null }>;
      if (data.length === 0) {
        return `<div style="padding:16px;border:1px dashed #d1d5db;border-radius:8px;color:#6b7280;font-size:0.9em">Bar chart data unavailable.</div>`;
      }
      const maxVal = Number(props.maxValue) || Math.max(...data.map((d) => d.value), 1);
      const width = 360;
      const height = 200;
      const padding = 24;
      const barWidth = Math.min(40, (width - padding * 2) / data.length - 8);
      const chartHeight = height - padding * 2 - 20;

      const bars = data.map((item, i) => {
        const color = item.color ?? PRINT_CHART_COLORS[i % PRINT_CHART_COLORS.length];
        const barH = Math.max(4, (Math.max(0, item.value) / Math.max(1, maxVal)) * chartHeight);
        const x = padding + (i * (width - padding * 2)) / data.length + ((width - padding * 2) / data.length - barWidth) / 2;
        const y = padding + chartHeight - barH;
        return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="4" fill="${color}"/>
          <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="var(--fg, #374151)" font-weight="500">${formatChartValue(item.value, props.valuePrefix as string | null, props.valueSuffix as string | null)}</text>
          <text x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--muted, #6b7280)">${esc(item.label)}</text>`;
      }).join("");

      const title = props.title ? `<div style="padding:12px 12px 0;font-weight:600;font-size:0.9em">${esc(props.title)}</div>` : "";
      return `<div style="border:1px solid var(--border, #e5e7eb);border-radius:8px;overflow:hidden;margin:12px 0">
        ${title}
        <div style="padding:8px">
          <svg viewBox="0 0 ${width} ${height}" style="width:100%">
            <line x1="${padding}" x2="${width - padding}" y1="${padding + chartHeight}" y2="${padding + chartHeight}" stroke="var(--border, #e5e7eb)"/>
            ${bars}
          </svg>
        </div>
      </div>`;
    }

    case "DonutChart": {
      const data = (props.data ?? []) as Array<{ label: string; value: number; color?: string | null }>;
      if (data.length === 0) {
        return `<div style="padding:16px;border:1px dashed #d1d5db;border-radius:8px;color:#6b7280;font-size:0.9em">Donut chart data unavailable.</div>`;
      }
      const radius = 44;
      const circumference = 2 * Math.PI * radius;
      const segments = buildDonutSegments(data, circumference);
      const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
      const centerLabel = esc(props.centerLabel ?? "Total");

      const segmentsSvg = segments.map((seg, i) => {
        const color = seg.color ?? PRINT_CHART_COLORS[i % PRINT_CHART_COLORS.length];
        return `<circle cx="60" cy="60" r="${radius}" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${seg.dashLength} ${circumference}" stroke-dashoffset="${seg.dashOffset}"/>`;
      }).join("");

      const legendRows = segments.map((seg, i) => {
        const color = seg.color ?? PRINT_CHART_COLORS[i % PRINT_CHART_COLORS.length];
        return `<tr>
          <td style="padding:4px 8px"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color}"></span></td>
          <td style="padding:4px 8px;font-size:0.85em">${esc(seg.label)}</td>
          <td style="padding:4px 8px;text-align:right;font-size:0.85em;font-weight:500">${formatChartValue(seg.value, null, props.valueSuffix as string | null)}</td>
          <td style="padding:4px 8px;text-align:right;font-size:0.8em;color:var(--muted, #6b7280)">${Math.round(seg.percentage * 100)}%</td>
        </tr>`;
      }).join("");

      const title = props.title ? `<div style="padding:12px 12px 0;font-weight:600;font-size:0.9em">${esc(props.title)}</div>` : "";
      return `<div style="border:1px solid var(--border, #e5e7eb);border-radius:8px;overflow:hidden;margin:12px 0">
        ${title}
        <div style="padding:12px;display:flex;align-items:center;gap:24px;flex-wrap:wrap">
          <div style="flex-shrink:0">
            <svg viewBox="0 0 120 120" width="140" height="140" style="transform:rotate(-90deg)">
              <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--border, #e5e7eb)" stroke-width="16"/>
              ${segmentsSvg}
              <g transform="rotate(90 60 60)">
                <text x="60" y="54" text-anchor="middle" font-size="11" fill="var(--muted, #6b7280)">${centerLabel}</text>
                <text x="60" y="70" text-anchor="middle" font-size="15" font-weight="700" fill="var(--fg, #1a1a1a)">${formatChartValue(total, null, props.valueSuffix as string | null)}</text>
              </g>
            </svg>
          </div>
          <table style="flex:1;border-collapse:collapse">${legendRows}</table>
        </div>
      </div>`;
    }

    case "Heading": {
      const level = String(props.level ?? "2");
      const sizes: Record<string, string> = {
        "1": "font-size:1.4em;font-weight:700",
        "2": "font-size:1.15em;font-weight:600",
        "3": "font-size:1em;font-weight:600;color:var(--fg, #374151)",
      };
      const style = sizes[level] ?? sizes["2"];
      const tag = level === "1" ? "h2" : level === "3" ? "h4" : "h3";
      return `<${tag} style="${style};margin:12px 0 6px">${esc(props.text)}</${tag}>`;
    }

    case "Text": {
      const variants: Record<string, string> = {
        body: "font-size:0.9em;color:var(--fg, #374151)",
        caption: "font-size:0.8em;color:var(--muted, #6b7280)",
        bold: "font-size:0.9em;font-weight:600;color:var(--fg, #1a1a1a)",
        muted: "font-size:0.9em;color:var(--muted, #6b7280)",
      };
      const style = variants[String(props.variant ?? "body")] ?? variants.body;
      return `<p style="${style};margin:6px 0">${esc(props.content)}</p>`;
    }

    case "Markdown": {
      return simpleMarkdownToHtml(String(props.content ?? ""));
    }

    case "BulletList": {
      const items = (props.items ?? []) as string[];
      const iconMap: Record<string, string> = {
        bullet: "\u2022",
        check: "\u2713",
        warning: "\u26A0",
        "arrow-up": "\u2191",
        "arrow-down": "\u2193",
      };
      const iconColorMap: Record<string, string> = {
        bullet: "#6b7280",
        check: "#16a34a",
        warning: "#ca8a04",
        "arrow-up": "#16a34a",
        "arrow-down": "#dc2626",
      };
      const icon = String(props.icon ?? "bullet");
      const prefix = iconMap[icon] ?? "\u2022";
      const iconColor = iconColorMap[icon] ?? "#6b7280";

      const variantColors: Record<string, string> = {
        success: "#166534",
        danger: "#991b1b",
        warning: "#854d0e",
        default: "var(--fg, #374151)",
      };
      const textColor = variantColors[String(props.variant ?? "default")] ?? "var(--fg, #374151)";

      const lis = items.map((item) =>
        `<li style="display:flex;align-items:flex-start;gap:8px;margin:4px 0;font-size:0.9em;color:${textColor}"><span style="color:${iconColor};flex-shrink:0">${prefix}</span><span>${esc(item)}</span></li>`
      ).join("");
      return `<ul style="list-style:none;padding:0;margin:8px 0">${lis}</ul>`;
    }

    case "LinkButton": {
      const url = String(props.url ?? "#");
      const text = esc(props.text);
      return `<a href="${esc(url)}" style="display:inline-block;padding:4px 12px;border-radius:4px;font-size:0.8em;font-weight:500;color:#2563eb;border:1px solid #2563eb;text-decoration:none;margin:4px 4px 4px 0">${text}</a>`;
    }

    case "SourceList": {
      const sources = (props.sources ?? []) as Array<{ title: string; url: string }>;
      const items = sources.map((s, i) =>
        `<span style="display:inline-block;margin:3px 6px 3px 0;font-size:0.8em">[${i + 1}] <a href="${esc(s.url)}" style="color:#2563eb;text-decoration:none">${esc(s.title)}</a></span>`
      ).join("");
      return `<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border, #e5e7eb)">${items}</div>`;
    }

    case "ChartImage": {
      const src = resolve(String(props.src ?? ""));
      const alt = esc(props.alt ?? "Chart");
      const caption = props.caption ? `<div style="font-size:0.8em;color:var(--muted, #6b7280);padding:6px 12px;border-top:1px solid var(--border, #e5e7eb)">${esc(props.caption)}</div>` : "";
      return `<div style="border:1px solid var(--border, #e5e7eb);border-radius:8px;overflow:hidden;margin:12px 0">
        <img src="${esc(src)}" alt="${alt}" style="width:100%;display:block"/>
        ${caption}
      </div>`;
    }

    case "FlightOption": {
      const isGood = props.score != null && Number(props.score) >= 80;
      const borderColor = isGood ? "#86efac" : "var(--border, #e5e7eb)";
      const bg = isGood ? "#f0fdf4" : "var(--card-bg, #fafafa)";
      const stops = Number(props.stops ?? 0);
      const stopsText = stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`;
      const price = `${esc(props.price)}${props.currency ? ` ${esc(props.currency)}` : ""}`;
      const extras: string[] = [];
      if (props.baggage) extras.push(esc(props.baggage));
      if (props.refundable != null) extras.push(props.refundable ? "Refundable" : "Non-refundable");
      const extrasHtml = extras.length > 0 ? `<div style="font-size:0.8em;color:var(--muted, #6b7280);margin-top:6px">${extras.join(" &middot; ")}</div>` : "";
      const scoreHtml = props.score != null ? `<div style="font-size:0.8em;color:var(--muted, #6b7280);margin-top:4px">Score: ${props.score}/100${props.scoreReason ? ` \u2014 ${esc(props.scoreReason)}` : ""}</div>` : "";
      const bookingHtml = props.bookingUrl ? `<a href="${esc(props.bookingUrl)}" style="display:inline-block;margin-top:6px;font-size:0.8em;color:#2563eb;text-decoration:none">Book &rarr;</a>` : "";

      return `<div style="border:1px solid ${borderColor};border-radius:8px;padding:12px;margin:8px 0;background:${bg}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <span style="font-weight:600">${esc(props.airline)}</span>
            ${props.flightNo ? `<span style="font-size:0.8em;color:#6b7280;margin-left:8px">${esc(props.flightNo)}</span>` : ""}
          </div>
          <span style="font-size:1.15em;font-weight:700">${price}</span>
        </div>
        <div style="font-size:0.9em;color:#6b7280">${esc(props.departure)} &rarr; ${esc(props.arrival)} &middot; ${esc(props.duration)} &middot; ${stopsText}</div>
        ${extrasHtml}${scoreHtml}${bookingHtml}
      </div>`;
    }

    default:
      return childrenHtml;
  }
}

/**
 * Convert a json-render spec to static HTML with inline CSS.
 * Returns `null` if the input is not a valid spec.
 */
export function specToStaticHtml(spec: unknown, options?: SpecToHtmlOptions): string | null {
  if (!spec || typeof spec !== "object") return null;
  const s = spec as Partial<JsonRenderSpec>;
  if (typeof s.root !== "string" || !s.elements || typeof s.elements !== "object") return null;
  try {
    return renderElement(s.root, s as JsonRenderSpec, options ?? {});
  } catch {
    return null;
  }
}
