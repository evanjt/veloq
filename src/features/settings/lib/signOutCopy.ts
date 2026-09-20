/**
 * The sign-out alert's message.
 *
 * The standing copy tells the athlete they will enter their credentials again.
 * Offline they cannot: both login paths make an unconditional network round
 * trip before anything is accepted, so a sign-out on a plane locks them out of
 * their own cached data for the rest of the trip.
 */
export function signOutMessage(base: string, offlineWarning: string, isOnline: boolean): string {
  if (isOnline) return base;
  if (base.includes(offlineWarning)) return base;
  return `${base}\n\n${offlineWarning}`;
}
