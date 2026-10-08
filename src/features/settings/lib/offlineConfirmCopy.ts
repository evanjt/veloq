/**
 * A destructive confirm's message, with the offline consequence added.
 *
 * The standing copy of signing out and of Clear and reload is written for a
 * device that is online: it promises the credentials can be entered again, or
 * that the library reloads. Offline neither can happen, because both login
 * paths and the reload make an unconditional network round trip, so the
 * athlete is locked out of their cached data, or left with an empty library,
 * until the connection returns. The action stays available; the copy says
 * what it costs.
 */
export function offlineConfirmMessage(
  base: string,
  offlineWarning: string,
  isOnline: boolean
): string {
  if (isOnline) return base;
  if (base.includes(offlineWarning)) return base;
  return `${base}\n\n${offlineWarning}`;
}
