/** One activity that moved the athlete's accepted eFTP. */
export interface EftpChange {
  /** The activity's local day, `YYYY-MM-DD`, which is what the plot keys on. */
  date: string;
  eftp: number;
  delta: number;
  activityId: string;
  activityName: string;
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
