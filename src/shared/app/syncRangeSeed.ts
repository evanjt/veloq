import { formatLocalDate } from '@/shared/format/format';

interface LaunchWindowStats {
  newestDate?: number | bigint;
  activityWindowOldest: string;
}

/**
 * Opens the sync range at the window the athlete asked the device to hold. The oldest stored
 * activity is not that: a ride kept only because a section or record names it can be years
 * older, and a range opened at its date downloads the whole span in between.
 */
export function seedSyncRange(
  stats: LaunchWindowStats | undefined,
  initializeRange: (oldest: string, newest: string) => void
): boolean {
  if (!stats?.newestDate || !stats.activityWindowOldest) return false;
  initializeRange(
    stats.activityWindowOldest,
    formatLocalDate(new Date(Number(stats.newestDate) * 1000))
  );
  return true;
}
