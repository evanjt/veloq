import type { Activity } from '@/types';

/** One activity that moved the athlete's accepted eFTP. */
export interface EftpChange {
  date: string;
  eftp: number;
  delta: number;
  activityId: string;
  activityName: string;
}

/**
 * The activities that changed the accepted eFTP, oldest first. The estimate
 * an activity produced is not a change: only a non-zero delta on the rolling
 * value is, which is what intervals.icu marks in red.
 */
export function eftpChanges(activities: Activity[] | undefined): EftpChange[] {
  if (!activities) return [];
  const changes: EftpChange[] = [];
  for (const a of activities) {
    const delta = a.icu_rolling_ftp_delta;
    const eftp = a.icu_rolling_ftp;
    if (!delta || !Number.isFinite(delta) || eftp === undefined || !Number.isFinite(eftp)) continue;
    const date = a.start_date_local?.split('T')[0];
    if (!date) continue;
    changes.push({ date, eftp, delta, activityId: a.id, activityName: a.name });
  }
  return changes.sort((x, y) => x.date.localeCompare(y.date));
}

/** The changes on one day, for a scrub label. */
export function eftpChangesOn(changes: EftpChange[], date: string | undefined): EftpChange[] {
  if (!date) return [];
  return changes.filter((c) => c.date === date);
}

/** `eFTP 367 W (+20)`, the same for a fall with its sign. */
export function formatEftpChange(change: EftpChange): string {
  const sign = change.delta > 0 ? '+' : '';
  return `eFTP ${Math.round(change.eftp)} W (${sign}${Math.round(change.delta)})`;
}
