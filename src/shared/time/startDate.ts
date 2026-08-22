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
