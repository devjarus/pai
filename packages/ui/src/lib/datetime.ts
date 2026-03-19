/**
 * Normalize API timestamps so SQLite UTC strings are interpreted consistently.
 */
export function normalizeApiTimestamp(raw: string): string {
  const value = raw.trim();
  const sqliteUtc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/;
  const match = value.match(sqliteUtc);
  if (match) return `${match[1]}T${match[2]}Z`;
  return value;
}

export function parseApiDate(raw: string): Date {
  return new Date(normalizeApiTimestamp(raw));
}

let configuredTimezone: string | undefined;

export function setConfiguredTimezone(timezone?: string): void {
  configuredTimezone = timezone || undefined;
}

export function formatWithTimezone(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  timezone?: string,
  locale?: string | string[],
): string {
  const resolvedTz = timezone ?? configuredTimezone;
  return date.toLocaleString(locale, resolvedTz ? { ...options, timeZone: resolvedTz } : options);
}

/** Relative time — "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(dateStr: string): string {
  const d = parseApiDate(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Compact relative time — "just now", "5m", "3h", "2d" (no "ago" suffix). */
export function timeAgoCompact(dateStr: string): string {
  const d = parseApiDate(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Format a date string for display — locale-aware, timezone-aware. */
export function formatDate(dateStr: string): string {
  const d = parseApiDate(dateStr);
  return isNaN(d.getTime()) ? dateStr : formatWithTimezone(d, {});
}

/** Format a date string with time — "Mar 17, 10:30 AM". */
export function formatDateTime(dateStr: string): string {
  const d = parseApiDate(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return formatWithTimezone(d, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Format an interval in hours as a cadence string — "Daily cadence", "6h cadence". */
export function formatInterval(hours: number): string {
  if (hours < 24) return `${hours}h cadence`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Daily cadence";
  if (days === 7) return "Weekly cadence";
  return `${days}d cadence`;
}
