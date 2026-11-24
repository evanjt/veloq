/**
 * Scenario: a registration with no credential names any athlete id. Ten of
 * them for one athlete used to push the athlete's verified tokens out through
 * the per-athlete cap.
 *
 * Expected behaviour: legacy rows are dropped before verified ones, and a
 * legacy newcomer into a full set of verified rows is dropped itself.
 */

import { capTokenRows } from '../../../oauth-proxy/src/tokenCap';

const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const originalFetch = global.fetch;

const row = (token: string, minute: number, legacy?: boolean | undefined) => ({
  token,
  registeredAt: `2026-01-01T00:${String(minute).padStart(2, '0')}:00.000Z`,
  legacy,
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('capTokenRows', () => {
  it('drops a newer legacy row before any verified row', () => {
    const verified = Array.from({ length: 10 }, (_, i) => row(`v${i}`, i, false));
    const { kept, dropped } = capTokenRows([...verified, row('legacy', 30, true)], 10);
    expect(kept).toEqual(verified);
    expect(dropped.map((r) => r.token)).toEqual(['legacy']);
  });

  it('drops legacy rows oldest first', () => {
    const rows = [row('l1', 1, true), row('v1', 2, false), row('l2', 3, true), row('l3', 4)];
    const { kept } = capTokenRows(rows, 2);
    expect(kept.map((r) => r.token)).toEqual(['v1', 'l3']);
  });

  it('drops the oldest verified row when every row is verified', () => {
    const rows = [row('v2', 2, false), row('v1', 1, false), row('v3', 3, false)];
    const { dropped } = capTokenRows(rows, 2);
    expect(dropped.map((r) => r.token)).toEqual(['v1']);
  });

  it('keeps everything at or under the cap', () => {
    const rows = [row('a', 1, true), row('b', 2, false)];
    expect(capTokenRows(rows, 2)).toEqual({ kept: rows, dropped: [] });
  });
});

describe('registering past the cap', () => {
  function memoryKv() {
    const entries = new Map<string, string>();
    return {
      entries,
      get: async (key: string, format?: string) => {
        const value = entries.get(key) ?? null;
        return format === 'json' && value ? JSON.parse(value) : value;
      },
      put: async (key: string, value: string) => {
        entries.set(key, value);
      },
      delete: async (key: string) => {
        entries.delete(key);
      },
    };
  }

  it('keeps all ten verified tokens against a credential-less registration', async () => {
    global.fetch = (async () => new Response('{}')) as unknown as typeof fetch;
    const env = { WEBHOOK_SECRET: 's', DEVICE_TOKENS: memoryKv(), OAUTH_STATES: memoryKv() };
    const stored = Array.from({ length: 10 }, (_, i) => ({
      token: `ExponentPushToken[v${i}]`,
      platform: 'android',
      registeredAt: new Date(Date.now() - (10 - i) * 60_000).toISOString(),
      legacy: false,
    }));
    env.DEVICE_TOKENS.entries.set('athlete:i101', JSON.stringify(stored));
    for (const r of stored) env.DEVICE_TOKENS.entries.set(`token:${r.token}`, 'i101');

    const intruder = 'ExponentPushToken[intruder]';
    const response = await worker.fetch(
      new Request('https://auth.veloq.fit/devices/register', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '203.0.113.50' },
        body: JSON.stringify({ athleteId: 'i101', token: intruder, platform: 'android' }),
      }),
      env
    );

    expect(response.status).toBe(200);
    const after = JSON.parse(env.DEVICE_TOKENS.entries.get('athlete:i101') ?? '[]');
    expect(after.map((r: { token: string }) => r.token)).toEqual(stored.map((r) => r.token));
    expect(env.DEVICE_TOKENS.entries.has(`token:${intruder}`)).toBe(false);
    expect(env.DEVICE_TOKENS.entries.get(`token:${stored[0].token}`)).toBe('i101');
  });
});
