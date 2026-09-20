/**
 * Proof Key for Code Exchange (RFC 7636), so the deep link back to the app
 * carries nothing worth stealing.
 *
 * The callback used to arrive as `veloq://oauth/callback?access_token=...`, and
 * any installed app that registers the `veloq` scheme receives it. Now the
 * redirect carries a one-time code instead, and the code is redeemed over HTTPS
 * by whoever can produce the verifier the challenge was made from. The app
 * registered that challenge before the browser ever opened, so a second app
 * holding the stolen code has nothing to redeem it with.
 */

const encoder = new TextEncoder();

/** The unreserved characters RFC 7636 allows in a verifier, and its length bounds. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/** Base64url of the SHA-256 of `verifier`: RFC 7636's `S256` challenge method. */
export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Whether `verifier` is a well-formed RFC 7636 verifier. */
export function isValidVerifier(verifier: unknown): verifier is string {
  return typeof verifier === "string" && VERIFIER_PATTERN.test(verifier);
}

/**
 * Whether `verifier` hashes to `challenge`. Anything malformed on either side
 * is refused before the comparison rather than hashed: the digest of the string
 * "undefined" is a real digest and would match another absent field.
 */
export async function verifierMatches(
  verifier: unknown,
  challenge: unknown
): Promise<boolean> {
  if (!isValidVerifier(verifier)) return false;
  if (typeof challenge !== "string" || challenge.length === 0) return false;

  const computed = encoder.encode(await codeChallengeFor(verifier));
  const expected = encoder.encode(challenge);
  if (computed.length !== expected.length) return false;

  let difference = 0;
  for (let i = 0; i < computed.length; i++) {
    difference |= computed[i] ^ expected[i];
  }
  return difference === 0;
}

/**
 * A one-time value nothing can guess: 32 random bytes as base64url. Used for
 * the exchange code the redirect carries and for the KV key it is stored under.
 */
export function newOpaqueToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
