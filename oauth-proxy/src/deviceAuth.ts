/**
 * Proving which athlete a device-token request speaks for.
 *
 * The register and unregister endpoints took the athlete id out of the request
 * body and wrote against it unauthenticated, so anyone who could reach the
 * worker could end another athlete's notifications or point them at their own
 * push token. The id in the body is now a claim, and the credential the app
 * already holds is what settles it: intervals.icu resolves the credential to
 * its athlete and the two have to agree.
 *
 * Both of the app's credentials are accepted, because both are sign-ins here:
 * `Bearer <access token>` for OAuth and `Basic <base64 of API_KEY:key>` for a
 * personal API key. The worker forwards the header rather than reading it, so
 * intervals.icu stays the only thing that understands either scheme.
 */

/** What a request proved, or why it proved nothing. */
export type DeviceAuth =
  | { ok: true; athleteId: string }
  | { ok: false; status: 401 | 403; error: string };

/** Answers the athlete a credential belongs to, or null when it belongs to none. */
export type AthleteResolver = (authorizationHeader: string) => Promise<string | null>;

/**
 * An `Authorization` header worth forwarding, normalised of surrounding space.
 *
 * The scheme is matched without case, which is what RFC 7235 requires of it,
 * and anything outside the two the app sends is refused here rather than spent
 * on a round trip.
 */
export function credentialHeader(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  return /^(Bearer|Basic)\s+\S+$/i.test(trimmed) ? trimmed : null;
}

/**
 * Whether this request may write the device tokens of `claimedAthleteId`.
 *
 * A resolver that throws is an intervals.icu outage, and an outage must not
 * read as a valid caller, so it refuses with the same answer a forged
 * credential gets. The resolver is called once: it is a network round trip.
 */
export async function authoriseDevice(
  authorizationHeader: string | null,
  claimedAthleteId: string,
  resolveAthlete: AthleteResolver
): Promise<DeviceAuth> {
  const credential = credentialHeader(authorizationHeader);
  if (!credential) {
    return { ok: false, status: 401, error: "Missing credential" };
  }

  let athleteId: string | null;
  try {
    athleteId = await resolveAthlete(credential);
  } catch {
    athleteId = null;
  }
  if (!athleteId) {
    return { ok: false, status: 401, error: "Invalid credential" };
  }

  if (athleteId !== claimedAthleteId) {
    return { ok: false, status: 403, error: "Athlete mismatch" };
  }

  return { ok: true, athleteId };
}

/** intervals.icu's own answer to "who is this credential". */
const INTERVALS_SELF_URL = "https://intervals.icu/api/v1/athlete/0";

/**
 * Resolve a credential against intervals.icu.
 *
 * Athlete `0` is the caller's own, so this asks nothing about any other id and
 * cannot be used to probe whether one exists. Measured 2026-09-12: it answers
 * 200 carrying the caller's id, while another athlete's id answers 403.
 */
export function intervalsAthleteResolver(fetchImpl: typeof fetch = fetch): AthleteResolver {
  return async (authorizationHeader) => {
    const response = await fetchImpl(INTERVALS_SELF_URL, {
      headers: { Authorization: authorizationHeader },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" && body.id.length > 0 ? body.id : null;
  };
}
