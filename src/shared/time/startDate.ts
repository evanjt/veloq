/**
 * intervals.icu sends `start_date_local` as a zoneless local wall clock, so no
 * true instant can be recovered from it. Both writers of `activity_metrics.date`
 * stamp those components as UTC, which keeps the athlete's calendar intact
 * wherever the device happens to be. Mirrors `start_date_to_timestamp` in
 * `objects/sync.rs`.
 */
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

export function startDateLocalToEpochSeconds(
  startDateLocal: string | null | undefined
): number | null {
  if (!startDateLocal) return null;
  const m = WALL_CLOCK.exec(startDateLocal);
  if (!m) return null;
  const [, year, month, day, hour, minute, second] = m;
  const ms = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Stamp a `Date`'s local calendar fields as UTC, the same way
 * `startDateLocalToEpochSeconds` stamps the components intervals.icu sends.
 * Window bounds built from the device clock have to go through here, or they
 * are true instants compared against wall clocks and the window slides by the
 * UTC offset.
 */
export function localWallClockToEpochSeconds(date: Date): number {
  return Math.floor(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    ) / 1000
  );
}
