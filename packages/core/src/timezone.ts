/**
 * Timezone-aware date/time formatting helpers.
 * Uses the configured IANA timezone (e.g. "America/Los_Angeles") or falls back to server timezone.
 */

export interface FormattedDateTime {
  /** e.g. "Friday, February 28, 2026" */
  date: string;
  /** e.g. "02:15 PM" */
  time: string;
  /** e.g. "Friday, February 28, 2026, 02:15 PM" */
  full: string;
  /** e.g. 2026 */
  year: number;
}

/**
 * Normalize timestamps coming from mixed sources.
 *
 * SQLite `datetime('now')` yields `YYYY-MM-DD HH:MM:SS` (UTC but no offset),
 * while JS and APIs commonly use ISO 8601 with explicit timezone.
 * This function converts SQLite-style UTC timestamps to proper ISO UTC format.
 */
export function normalizeTimestamp(raw: string): string {
  const value = raw.trim();
  const sqliteUtc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/;
  const match = value.match(sqliteUtc);
  if (match) return `${match[1]}T${match[2]}Z`;
  return value;
}

/** Parse a timestamp into a Date with SQLite UTC normalization. */
export function parseTimestamp(raw: string): Date {
  return new Date(normalizeTimestamp(raw));
}

/**
 * Format the current date/time using the configured timezone.
 * @param timezone IANA timezone string (e.g. "America/Los_Angeles"). Undefined = server default.
 * @param now Optional Date object (defaults to new Date())
 */
export function formatDateTime(timezone?: string, now?: Date): FormattedDateTime {
  const d = now ?? new Date();
  const opts: Intl.DateTimeFormatOptions = timezone ? { timeZone: timezone } : {};

  const date = d.toLocaleDateString("en-US", {
    ...opts,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const time = d.toLocaleTimeString("en-US", {
    ...opts,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  // Extract year in the configured timezone
  const year = Number(d.toLocaleDateString("en-US", { ...opts, year: "numeric" }));

  return { date, time, full: `${date}, ${time}`, year };
}
