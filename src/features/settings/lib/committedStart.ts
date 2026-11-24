import { parseDayString } from '@/shared/format/format';

/**
 * The start the range slider treats as already downloaded.
 *
 * Both inputs are day strings, and the slider's year ticks sit on local
 * midnight, so each reads as a local day. `new Date('2024-01-01')` is UTC
 * midnight, which east of UTC falls before the tick for the same day and made
 * a handle returned to it look like an expansion.
 */
export function committedStart(
  syncOldest: string,
  cacheOldest: string | null | undefined,
  isExpansionLocked: boolean
): Date {
  const syncStart = parseDayString(syncOldest);
  if (isExpansionLocked || !cacheOldest) return syncStart;
  const cacheStart = parseDayString(cacheOldest);
  return cacheStart < syncStart ? cacheStart : syncStart;
}
