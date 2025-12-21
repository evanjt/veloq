import { useMemo } from 'react';
import type { Activity, eFTPPoint } from '@/types';

/**
 * Extract eFTP history from activities
 * Returns activities that have eFTP estimates, formatted for the chart
 *
 * Note: API uses icu_pm_ftp_watts for estimated FTP from activity
 */
export function useEFTPHistory(activities: Activity[] | undefined): eFTPPoint[] | undefined {
  return useMemo(() => {
    if (!activities || activities.length === 0) return undefined;

    // Filter activities that have eFTP estimates (icu_pm_ftp_watts)
    const withEFTP = activities
      .filter(a => a.icu_pm_ftp_watts && a.icu_pm_ftp_watts > 0)
      .map(a => ({
        date: a.start_date_local.split('T')[0], // ISO date only
        eftp: a.icu_pm_ftp_watts!,
        activity_id: a.id,
        activity_name: a.name,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)); // Sort chronologically

    if (withEFTP.length === 0) return undefined;

    // If we have many points, sample to avoid cluttering
    // Keep first, last, and highest values + regularly spaced points
    if (withEFTP.length > 30) {
      const sampled: eFTPPoint[] = [];
      const step = Math.floor(withEFTP.length / 25);

      // Always include first point
      sampled.push(withEFTP[0]);

      // Sample evenly
      for (let i = step; i < withEFTP.length - 1; i += step) {
        sampled.push(withEFTP[i]);
      }

      // Always include last point
      if (sampled[sampled.length - 1] !== withEFTP[withEFTP.length - 1]) {
        sampled.push(withEFTP[withEFTP.length - 1]);
      }

      return sampled;
    }

    return withEFTP;
  }, [activities]);
}

/**
 * Get the current (latest) FTP from activities
 * Uses icu_ftp (the FTP setting used for the activity) as the source
 */
export function getLatestFTP(activities: Activity[] | undefined): number | undefined {
  if (!activities || activities.length === 0) return undefined;

  // Find most recent activity with FTP setting
  const withFTP = activities
    .filter(a => a.icu_ftp && a.icu_ftp > 0)
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));

  return withFTP[0]?.icu_ftp;
}

/**
 * Get the latest estimated FTP from power model
 */
export function getLatestEFTP(activities: Activity[] | undefined): number | undefined {
  if (!activities || activities.length === 0) return undefined;

  // Find most recent activity with eFTP estimate
  const withEFTP = activities
    .filter(a => a.icu_pm_ftp_watts && a.icu_pm_ftp_watts > 0)
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));

  return withEFTP[0]?.icu_pm_ftp_watts;
}
