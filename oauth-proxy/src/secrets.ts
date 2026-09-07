/**
 * Comparing a secret without saying how close a guess was.
 *
 * `a !== b` on strings returns at the first character that differs, so the time
 * it takes leaks the length of the matching prefix to anyone who can call the
 * endpoint, and the webhook route is public. Hashing both sides first gives two
 * fixed-length digests: the comparison then walks the same 32 bytes whatever
 * came in, and the length of the guess is not visible either.
 */

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/**
 * Whether `provided` is the expected secret. Anything that is not a non-empty
 * string is refused before it reaches the comparison: an absent field parses to
 * `undefined`, and comparing that would be a match against the digest of the
 * string "undefined".
 */
export async function secretsMatch(provided: unknown, expected: string): Promise<boolean> {
  if (typeof provided !== "string" || provided.length === 0) return false;

  const [a, b] = await Promise.all([digest(provided), digest(expected)]);

  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}
