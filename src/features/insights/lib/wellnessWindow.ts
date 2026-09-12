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
