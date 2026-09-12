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

/** Rate-limit counter, one per client address. */
export function rateKey(ip: string): string {
  return `rate:${ip}`;
}

/** The PKCE exchange code a callback parks the token under. */
export function exchangeKey(code: string): string {
  return `exchange:${code}`;
}

/** One webhook event, so a re-delivery is not acted on twice. */
export function dedupeKey(
  athleteId: string | number,
  type: string,
  activityId: string | number | undefined
): string {
  return `dedup:${athleteId}:${type}:${activityId ?? "none"}`;
}
