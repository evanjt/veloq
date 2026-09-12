/**
 * Scenario: one KV namespace holds three kinds of key. The rate limiter writes
 * `rate:<ip>`, the webhook dedupe writes `dedup:<athlete>:<type>:<id>` and the
 * PKCE exchange writes `exchange:<code>`, but the OAuth `state` was stored
 * under the raw client-supplied string. A client choosing its own state can
 * therefore write or read either of the other two.
 *
 * Expected behaviour: every key in the namespace carries a prefix that says
 * what it is, the state included, so no client-supplied value can name
 * another kind of key.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stateKey } from '../../../oauth-proxy/src/keys';

const worker = readFileSync(resolve(__dirname, '../../../oauth-proxy/src/worker.ts'), 'utf8');

describe('the OAuth state key', () => {
  it('carries a prefix of its own', () => {
    expect(stateKey('abc')).toBe('state:abc');
  });

  it('cannot be made to name a rate-limit, dedupe or exchange key', () => {
    expect(stateKey('rate:1.2.3.4')).toBe('state:rate:1.2.3.4');
    expect(stateKey('dedup:i1:ACTIVITY:9')).toBe('state:dedup:i1:ACTIVITY:9');
    expect(stateKey('exchange:xyz')).toBe('state:exchange:xyz');
  });

  it('is what the worker reads, writes and deletes with', () => {
    expect(worker).not.toMatch(/OAUTH_STATES\.(get|put|delete)\(\s*state\s*[,)]/);
    for (const call of ['put', 'get', 'delete']) {
      expect(worker).toContain(`OAUTH_STATES.${call}(stateKey(state)`);
    }
  });
});

describe('a malformed token response', () => {
  it('is logged by its shape, never by its contents', () => {
    expect(worker).not.toContain('console.error("Invalid token response:", tokenData)');
    expect(worker).toContain('Object.keys(tokenData)');
  });
});

describe('the app manifest', () => {
  const appJson = JSON.parse(readFileSync(resolve(__dirname, '../../../app.json'), 'utf8')) as {
    expo: Record<string, unknown>;
  };

  /// expo-camera's plugin defaults `recordAudioAndroid` to true, and with no
  /// entry in app.json a prebuild wrote RECORD_AUDIO into the manifest. The
  /// only camera use is the QR scanner, which records nothing.
  it('turns off the camera plugin audio permission', () => {
    const plugins = appJson.expo.plugins as (string | [string, Record<string, unknown>])[];
    const camera = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-camera');
    expect(camera).toBeDefined();
    expect((camera as [string, Record<string, unknown>])[1]).toEqual({
      recordAudioAndroid: false,
    });
  });

  /// `applinks:intervals.icu` claimed a domain Veloq does not control, and
  /// nothing in the app handles an https intervals.icu link: the one place
  /// that opens one hands it to the browser.
  it('claims no associated domain', () => {
    expect((appJson.expo.ios as Record<string, unknown>).associatedDomains).toBeUndefined();
  });
});
