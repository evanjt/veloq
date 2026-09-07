/**
 * Scenario: the webhook endpoint is a public route and it compared the shared
 * secret with `!==`, which returns as soon as two characters differ. How long
 * the comparison takes then says how much of a guess was right.
 *
 * Expected behaviour: the comparison takes the same path whatever the input,
 * and refuses anything that is not a matching string. A timing measurement is
 * not the test here: it would measure the machine rather than the code.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { secretsMatch } from '../../../oauth-proxy/src/secrets';

const SECRET = 'a-long-random-webhook-secret-0123456789';

describe('comparing the webhook secret', () => {
  it('accepts the secret itself', async () => {
    await expect(secretsMatch(SECRET, SECRET)).resolves.toBe(true);
  });

  it('refuses a wrong secret of the same length', async () => {
    const wrong = `${SECRET.slice(0, -1)}X`;
    expect(wrong).toHaveLength(SECRET.length);
    await expect(secretsMatch(wrong, SECRET)).resolves.toBe(false);
  });

  it('refuses a wrong secret that shares its opening', async () => {
    await expect(secretsMatch(SECRET.slice(0, 10), SECRET)).resolves.toBe(false);
  });

  it('refuses an empty string, which an absent field parses to', async () => {
    await expect(secretsMatch('', SECRET)).resolves.toBe(false);
  });

  it('refuses what is not a string at all', async () => {
    await expect(secretsMatch(undefined, SECRET)).resolves.toBe(false);
    await expect(secretsMatch(null, SECRET)).resolves.toBe(false);
    await expect(secretsMatch({ length: 38 }, SECRET)).resolves.toBe(false);
  });
});

describe('the worker itself', () => {
  const worker = readFileSync(resolve(__dirname, '../../../oauth-proxy/src/worker.ts'), 'utf8');

  it('no longer compares the secret with an early-returning operator', () => {
    expect(worker).not.toMatch(/payload\.secret\s*!==\s*env\.WEBHOOK_SECRET/);
    expect(worker).toMatch(/secretsMatch\(/);
  });
});
