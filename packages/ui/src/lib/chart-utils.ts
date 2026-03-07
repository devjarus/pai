export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartBounds {
  min: number;
  max: number;
  range: number;
}

export interface DonutSegmentInput {
  label: string;
  value: number;
  color?: string | null;
}

export interface DonutSegment {
  label: string;
  value: number;
  color?: string | null;
  percentage: number;
  dashLength: number;
  dashOffset: number;
}

export function getChartBounds(values: number[], explicitMin?: number | null, explicitMax?: number | null): ChartBounds {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (safeValues.length === 0) {
    return { min: 0, max: 1, range: 1 };
  }

  let min = explicitMin ?? Math.min(...safeValues);
  let max = explicitMax ?? Math.max(...safeValues);

  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= padding;
    max += padding;
  }

  return { min, max, range: max - min };
}

export function buildLinePoints(values: number[], width: number, height: number, padding: number, explicitMin?: number | null, explicitMax?: number | null): ChartPoint[] {
  if (values.length === 0) return [];
  const { min, range } = getChartBounds(values, explicitMin, explicitMax);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);

  return values.map((value, index) => {
    const x = padding + (values.length === 1 ? innerWidth / 2 : (innerWidth * index) / (values.length - 1));
    const ratio = (value - min) / range;
    const y = padding + innerHeight - ratio * innerHeight;
    return { x, y };
  });
}

export function buildLinePath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function buildAreaPath(points: ChartPoint[], height: number, padding: number): string {
  if (points.length === 0) return "";
  const linePath = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  const baseline = Math.max(padding, height - padding);
  return `${linePath} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

export function buildDonutSegments(data: DonutSegmentInput[], circumference: number): DonutSegment[] {
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  let offset = 0;

  return data.map((item) => {
    const percentage = total > 0 ? Math.max(0, item.value) / total : 0;
    const dashLength = percentage * circumference;
    const segment: DonutSegment = {
      label: item.label,
      value: item.value,
      color: item.color ?? null,
      percentage,
      dashLength,
      dashOffset: -offset,
    };
    offset += dashLength;
    return segment;
  });
}

export function formatChartValue(value: number, prefix?: string | null, suffix?: string | null): string {
  const abs = Math.abs(value);
  let formatted: string;

  if (abs >= 1_000_000_000) {
    formatted = `${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (abs >= 1_000_000) {
    formatted = `${(value / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    formatted = `${(value / 1_000).toFixed(1)}K`;
  } else if (Number.isInteger(value)) {
    formatted = String(value);
  } else {
    formatted = value.toFixed(2);
  }

  return `${prefix ?? ""}${formatted}${suffix ?? ""}`;
}
