/**
 * Scenario: sign-in redirected back to the app as
 * `veloq://oauth/callback?access_token=...`. Android's `singleTask` launch mode
 * hands that URL to any installed app that registers the `veloq` scheme, so a
 * second app on the device read the intervals.icu bearer token on every
 * sign-in.
 *
 * Expected behaviour: the redirect carries a one-time code and nothing else
 * worth having, and the code is redeemed over HTTPS by whoever can produce the
 * verifier its challenge was made from. A stolen code is useless on its own.
 */

import {
  codeChallengeFor,
  isValidVerifier,
  verifierMatches,
  newOpaqueToken,
} from '../../../oauth-proxy/src/pkce';

const VERIFIER = 'a'.repeat(43);

describe('the code challenge', () => {
  it('is the base64url SHA-256 of the verifier, with no padding', async () => {
    const challenge = await codeChallengeFor(VERIFIER);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toContain('=');
  });

  it('is the value RFC 7636 gives for its own worked example', async () => {
    await expect(codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('is the same for the same verifier and different for another', async () => {
    const [a, b, c] = await Promise.all([
      codeChallengeFor(VERIFIER),
      codeChallengeFor(VERIFIER),
      codeChallengeFor('b'.repeat(43)),
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('redeeming a code', () => {
  it('accepts the verifier the challenge was made from', async () => {
    await expect(verifierMatches(VERIFIER, await codeChallengeFor(VERIFIER))).resolves.toBe(true);
  });

  it('refuses any other verifier, which is what a stolen code is left with', async () => {
    await expect(verifierMatches('b'.repeat(43), await codeChallengeFor(VERIFIER))).resolves.toBe(
      false
    );
  });

  it('refuses a verifier shorter or longer than RFC 7636 allows', () => {
    expect(isValidVerifier('a'.repeat(42))).toBe(false);
    expect(isValidVerifier('a'.repeat(43))).toBe(true);
    expect(isValidVerifier('a'.repeat(128))).toBe(true);
    expect(isValidVerifier('a'.repeat(129))).toBe(false);
  });

  it('refuses a verifier carrying characters outside the unreserved set', () => {
    expect(isValidVerifier(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isValidVerifier(`${'a'.repeat(42)}/`)).toBe(false);
    expect(isValidVerifier(`${'a'.repeat(39)}-._~`)).toBe(true);
  });

  it('refuses what is not a string, which an absent field parses to', async () => {
    const challenge = await codeChallengeFor(VERIFIER);
    await expect(verifierMatches(undefined, challenge)).resolves.toBe(false);
    await expect(verifierMatches(null, challenge)).resolves.toBe(false);
    await expect(verifierMatches({ length: 43 }, challenge)).resolves.toBe(false);
  });

  it('refuses an absent or empty challenge rather than hashing against one', async () => {
    await expect(verifierMatches(VERIFIER, undefined)).resolves.toBe(false);
    await expect(verifierMatches(VERIFIER, '')).resolves.toBe(false);
  });
});

describe('the one-time code', () => {
  it('is base64url and long enough that nothing guesses it', () => {
    expect(newOpaqueToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is a different value every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newOpaqueToken()));
    expect(seen.size).toBe(50);
  });
});
