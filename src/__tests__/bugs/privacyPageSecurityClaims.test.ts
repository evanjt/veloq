/**
 * Scenario: the privacy page told athletes their webhooks were verified by
 * HMAC-SHA256. The worker compares a shared secret carried in the request body,
 * which is what intervals.icu sends, and computes no signature at all.
 *
 * Expected behaviour: the page describes the mechanism the worker implements.
 * A security claim the code does not make is worse than a weaker claim that is
 * true, because it is the one an athlete reads before deciding to trust it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const page = readFileSync(resolve(root, 'docs/privacy/index.html'), 'utf8');
const worker = readFileSync(resolve(root, 'oauth-proxy/src/worker.ts'), 'utf8');

/** A real signature check would compute one. Nothing else counts as evidence. */
const workerSignsWebhooks =
  /crypto\.subtle\.(sign|verify|importKey)/.test(worker) && /HMAC/i.test(worker);

describe('what the privacy page claims about webhooks', () => {
  it('does not promise a signature the worker never computes', () => {
    if (workerSignsWebhooks) return;
    expect(page).not.toMatch(/HMAC/i);
  });

  it('says what the worker actually does, in every language on the page', () => {
    if (workerSignsWebhooks) return;
    const claims = page.match(/"security\.item4":\s*"([^"]*)"/g) ?? [];
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim).toMatch(/secret|Secret|secreto|secrète/);
    }
  });

  it('still verifies something, so the page is not claiming an open endpoint', () => {
    expect(worker).toMatch(/secretsMatch\(payload\.secret, env\.WEBHOOK_SECRET\)/);
  });
});
