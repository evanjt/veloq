/**
 * Key prefixes for the `OAUTH_STATES` namespace.
 *
 * One namespace holds three kinds of key and used to hold a fourth unprefixed:
 * the OAuth `state` went in under the raw client-supplied string, so a client
 * choosing its own state could name a `rate:` or `dedup:` key and read or
 * overwrite it. Every key is built here now, and every one of them says what
 * it is.
 */

/** CSRF state, minted by the app and handed back by intervals.icu. */
export function stateKey(state: string): string {
  return `state:${state}`;
}

/** A route with its own rate-limit budget. */
export type RateRoute = "state" | "token" | "device-register" | "device-unregister";

/**
 * Rate-limit counter, one per route and client address, so registering a state,
 * redeeming a code and each device route have their own budget, and push
 * traffic never spends what a sign-in needs.
 */
export function rateKey(route: RateRoute, ip: string): string {
  return `rate:${route}:${ip}`;
}

/** The PKCE exchange code a callback parks intervals.icu's code under. */
export function exchangeKey(code: string): string {
  return `exchange:${code}`;
}

/**
 * One webhook event, so a re-delivery is not acted on twice. The timestamp
 * tells apart two events of one type that carry no activity, which a
 * re-delivery repeats.
 */
export function dedupeKey(
  athleteId: string | number,
  type: string,
  activityId: string | number | undefined,
  timestamp: string | undefined
): string {
  return `dedup:${athleteId}:${type}:${activityId ?? "none"}:${timestamp ?? "none"}`;
}
