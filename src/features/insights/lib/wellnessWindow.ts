import { formatLocalDate } from '@/shared/format/format';

/**
 * The wellness window the insight generators read, as the engine wants it.
 *
 * Dated locally, because the foreground reads the same window that way
 * (`useWellness.ts`). Spelling it through `toISOString()` drops today's row
 * anywhere east of UTC until local mid-morning, which is exactly when the
 * headless push task runs after an overnight ride.
 */
export function wellnessWindow(now: Date, days: number): { oldest: string; newest: string } {
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - days);

  return { oldest: formatLocalDate(oldest), newest: formatLocalDate(now) };
}

/**
 * The date to caption the insights panel with when the form cards have been
 * dropped for want of a wellness row inside the window.
 *
 * The window is anchored on today, so a library last synced a month ago
 * answers empty and every form insight falls out of the panel silently.
 * Naming the last sync is what tells that apart from an athlete who has
 * never synced wellness at all, who has no sync to date and keeps the
 * ordinary empty state.
 */
export function droppedFormSyncDate(
  windowRows: readonly unknown[] | null | undefined,
  latestStoredDate: string | null | undefined
): string | null {
  if (windowRows && windowRows.length > 0) return null;
  return latestStoredDate ?? null;
}
