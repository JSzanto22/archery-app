/**
 * Display formatting shared across screens.
 *
 * Each of these existed twice with slightly different wording — "1 arrows" in
 * one place, a correctly pluralised string in another. Small divergences, but
 * they are what makes an app read as unfinished.
 */

/** "1 arrow", "6 arrows". */
export function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** "3 Aug 2026" — the format the session list and detail header share. */
export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "Monday, 3 August 2026" — for a screen about one session. */
export function formatLongDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "14:32" — used for the last-synced line. */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A normalized fraction of the face reads better as a percentage. */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
