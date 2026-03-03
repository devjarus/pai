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
