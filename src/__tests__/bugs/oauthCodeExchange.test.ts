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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

describe('the proxy redirect back to the app', () => {
  const worker = readFileSync(resolve(__dirname, '../../../oauth-proxy/src/worker.ts'), 'utf8');

  it('puts a one-time code in the deep link, not the access token', () => {
    const redirect = worker.slice(
      worker.indexOf('function redirectToAppWithCode'),
      worker.indexOf('function redirectToAppWithLegacyToken')
    );
    expect(redirect).not.toMatch(/access_token:\s*token\.access_token/);
    expect(redirect).toMatch(/code:/);
  });

  it('reaches the token-in-URL redirect only for a build that registered no challenge', () => {
    const callback = worker.slice(
      worker.indexOf('async function handleOAuthCallback'),
      worker.indexOf('function challengeFromStoredState')
    );
    expect(callback).toMatch(/if \(!challenge\) \{\n\s*return redirectToAppWithLegacyToken/);
    // One caller, and it is that branch.
    expect(callback.match(/redirectToAppWithLegacyToken\(/g)).toHaveLength(1);
  });

  it('spends the code before it knows whether the verifier was right', () => {
    const exchange = worker.slice(worker.indexOf('async function handleTokenExchange'));
    const deleted = exchange.indexOf('await env.OAUTH_STATES.delete(exchangeKey(code));\n\n  if');
    const checked = exchange.indexOf('verifierMatches(');
    expect(deleted).toBeGreaterThan(-1);
    expect(deleted).toBeLessThan(checked);
  });

  it('answers every refusal the same way, so nothing says which half was wrong', () => {
    const exchange = worker.slice(worker.indexOf('async function handleTokenExchange'));
    const refusals = exchange.match(/exchangeRefused\("([a-z_]+)"\)/g) ?? [];
    expect(refusals.length).toBeGreaterThan(3);
    for (const refusal of refusals) {
      expect(refusal).toMatch(/"(invalid_request|invalid_grant)"/);
    }
  });

  it('keeps the token out of every cache on the way back', () => {
    const exchange = worker.slice(worker.indexOf('async function handleTokenExchange'));
    expect(exchange).toMatch(/"Cache-Control": "no-store"/);
  });

  it('exposes the HTTPS exchange the app redeems the code at', () => {
    expect(worker).toMatch(/path === "\/oauth\/token" && request\.method === "POST"/);
  });

  it('checks the verifier against the stored challenge before handing anything back', () => {
    const exchange = worker.slice(worker.indexOf('async function handleTokenExchange'));
    expect(exchange).toMatch(/verifierMatches\(/);
  });
});
