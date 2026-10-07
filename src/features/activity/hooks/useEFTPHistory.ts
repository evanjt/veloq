import type { Activity } from '@/types';

/**
 * Get the current (latest) FTP from activities
 * Uses icu_ftp (the FTP setting used for the activity) as the source
 */
export function getLatestFTP(activities: Activity[] | undefined): number | undefined {
  if (!activities || activities.length === 0) return undefined;

  // Find most recent activity with FTP setting
  const withFTP = activities
    .filter((a) => a.icu_ftp && a.icu_ftp > 0)
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));

  return withFTP[0]?.icu_ftp;
}
