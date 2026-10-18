/**
 * Scenario: installs from before device verification register their push token
 * with no credential, and their Android build draws only the visible push: its
 * data handler never runs. Refusing those registrations, or sending their
 * tokens the data push alone, leaves an athlete who has not updated with no
 * notification at all.
 *
 * Expected behaviour: a registration with no credential is accepted and stored
 * flagged legacy, and a legacy Android token gets the visible push on the
 * channel those builds create beside the data push. A verified registration
 * is stored unflagged, gets the data push alone on Android, and always wins
 * over a legacy one for the same token.
 */

import { buildPushMessages } from '../../../oauth-proxy/src/pushMessages';

const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const TOKEN = 'ExponentPushToken[kiln-phone]';
const VISIBLE = { title: 'Activity Recorded', body: 'New activity received' };
const DATA = { event_type: 'ACTIVITY_UPLOADED', athlete_id: 'i101', activity_id: 'a-1' };
const originalFetch = global.fetch;

function memoryKv() {
  const entries = new Map<string, string>();
  return {
    entries,
    get: jest.fn(async (key: string, format?: string) => {
      const value = entries.get(key) ?? null;
      return format === 'json' && value ? JSON.parse(value) : value;
    }),
    put: jest.fn(async (key: string, value: string) => {
      entries.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      entries.delete(key);
    }),
  };
}

/** Every outbound request: intervals.icu lookups answer the bearer as the athlete. */
let outbound: jest.Mock;

function makeEnv() {
  outbound = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('https://intervals.icu')) {
      const authorization = (init?.headers as { Authorization: string }).Authorization;
      return new Response(JSON.stringify({ id: authorization.slice('Bearer '.length) }));
    }
    return new Response(JSON.stringify({ data: { status: 'ok' } }));
  });
  global.fetch = outbound as unknown as typeof fetch;
  return {
    WEBHOOK_SECRET: 'kiln-secret',
    DEVICE_TOKENS: memoryKv(),
    OAUTH_STATES: memoryKv(),
  };
}

function deviceRequest(
  method: 'POST' | 'DELETE',
  athleteId: string,
  options: { authorization?: string; platform?: string; ip?: string } = {}
) {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': options.ip ?? '203.0.113.9',
  };
  if (options.authorization !== undefined) headers.Authorization = options.authorization;
  const path = method === 'POST' ? 'register' : 'unregister';
  return new Request(`https://auth.veloq.fit/devices/${path}`, {
    method,
    headers,
    body: JSON.stringify({ athleteId, token: TOKEN, platform: options.platform ?? 'android' }),
  });
}

const register = (athleteId: string, options?: Parameters<typeof deviceRequest>[2]) =>
  deviceRequest('POST', athleteId, options);
const verified = (athleteId: string) => ({ authorization: `Bearer ${athleteId}` });

function rows(env: ReturnType<typeof makeEnv>, athleteId: string) {
  return JSON.parse(env.DEVICE_TOKENS.entries.get(`athlete:${athleteId}`) ?? '[]') as {
    token: string;
    legacy?: boolean;
  }[];
}

function intervalsLookups() {
  return outbound.mock.calls.filter(([url]) => String(url).startsWith('https://intervals.icu'));
}

function expoPushes() {
  return outbound.mock.calls
    .filter(([url]) => String(url).startsWith('https://exp.host'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('the messages a legacy token gets', () => {
  it('sends a legacy Android token the visible push and the data push', () => {
    const sent = buildPushMessages(TOKEN, DATA, VISIBLE, 'android', true);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      to: TOKEN,
      title: VISIBLE.title,
      body: VISIBLE.body,
      data: { activityId: 'a-1', route: '/activity/a-1', ...DATA },
      priority: 'high',
      channelId: 'veloq-insights',
    });
    expect(sent[1]).toEqual({ to: TOKEN, data: DATA, priority: 'high', _contentAvailable: true });
  });

  it('sends a verified Android token the data push alone', () => {
    const sent = buildPushMessages(TOKEN, DATA, VISIBLE, 'android', false);
    expect(sent).toEqual([{ to: TOKEN, data: DATA, priority: 'high', _contentAvailable: true }]);
  });

  it('sends a legacy Android token only the data push for an event with no visible line', () => {
    expect(buildPushMessages(TOKEN, DATA, null, 'android', true)).toHaveLength(1);
  });

  it('sends iOS the same either way', () => {
    expect(buildPushMessages(TOKEN, DATA, VISIBLE, 'ios', true)).toEqual(
      buildPushMessages(TOKEN, DATA, VISIBLE, 'ios', false)
    );
  });
});

describe('registering a device', () => {
  it('stores a registration with no credential as legacy, without an intervals.icu lookup', async () => {
    const env = makeEnv();
    expect((await worker.fetch(register('i101'), env)).status).toBe(200);
    expect(rows(env, 'i101')).toEqual([expect.objectContaining({ token: TOKEN, legacy: true })]);
    expect(env.DEVICE_TOKENS.entries.get(`token:${TOKEN}`)).toBe('i101');
    expect(intervalsLookups()).toHaveLength(0);
  });

  it('stores a verified registration unflagged', async () => {
    const env = makeEnv();
    expect((await worker.fetch(register('i101', verified('i101')), env)).status).toBe(200);
    expect(rows(env, 'i101')).toEqual([expect.objectContaining({ token: TOKEN, legacy: false })]);
  });

  it('still refuses a credential it cannot read rather than falling back to legacy', async () => {
    const env = makeEnv();
    const response = await worker.fetch(register('i101', { authorization: 'Basic a2V5' }), env);
    expect(response.status).toBe(401);
    expect(rows(env, 'i101')).toEqual([]);
  });

  it('replaces a legacy row with the verified registration for the same token', async () => {
    const env = makeEnv();
    await worker.fetch(register('i101'), env);
    await worker.fetch(register('i101', verified('i101')), env);
    expect(rows(env, 'i101')).toEqual([expect.objectContaining({ token: TOKEN, legacy: false })]);
  });

  it('keeps the verified row when a legacy registration for the same token follows', async () => {
    const env = makeEnv();
    await worker.fetch(register('i101', verified('i101')), env);
    const response = await worker.fetch(register('i101'), env);
    expect(response.status).toBe(401);
    expect(rows(env, 'i101')).toEqual([expect.objectContaining({ token: TOKEN, legacy: false })]);
  });

  it('does not let a legacy registration take a verified token from its athlete', async () => {
    const env = makeEnv();
    await worker.fetch(register('i101', verified('i101')), env);
    const response = await worker.fetch(register('i202'), env);
    expect(response.status).toBe(401);
    expect(rows(env, 'i101')).toEqual([expect.objectContaining({ token: TOKEN, legacy: false })]);
    expect(rows(env, 'i202')).toEqual([]);
    expect(env.DEVICE_TOKENS.entries.get(`token:${TOKEN}`)).toBe('i101');
  });

  it('moves a legacy token to the athlete who verifies it next', async () => {
    const env = makeEnv();
    await worker.fetch(register('i101'), env);
    await worker.fetch(register('i202', verified('i202')), env);
    expect(rows(env, 'i101')).toEqual([]);
    expect(rows(env, 'i202')).toEqual([expect.objectContaining({ token: TOKEN, legacy: false })]);
  });
});

describe('unregistering a device with no credential', () => {
  it('removes a legacy row', async () => {
    const env = makeEnv();
    await worker.fetch(register('i101'), env);
    expect((await worker.fetch(deviceRequest('DELETE', 'i101'), env)).status).toBe(200);
    expect(rows(env, 'i101')).toEqual([]);
    expect(env.DEVICE_TOKENS.entries.has(`token:${TOKEN}`)).toBe(false);
  });

  it('refuses for a verified row and leaves it in place', async () => {
    const env = makeEnv();
    await worker.fetch(register('i101', verified('i101')), env);
    expect((await worker.fetch(deviceRequest('DELETE', 'i101'), env)).status).toBe(401);
    expect(rows(env, 'i101')).toEqual([expect.objectContaining({ token: TOKEN, legacy: false })]);
    expect(env.DEVICE_TOKENS.entries.get(`token:${TOKEN}`)).toBe('i101');
  });

  it('still removes a verified row when the credential comes with it', async () => {
    const env = makeEnv();
    await worker.fetch(register('i101', verified('i101')), env);
    const response = await worker.fetch(deviceRequest('DELETE', 'i101', verified('i101')), env);
    expect(response.status).toBe(200);
    expect(rows(env, 'i101')).toEqual([]);
  });
});

describe('the webhook pushes by the stored flag', () => {
  function webhook() {
    return new Request('https://auth.veloq.fit/webhook/intervals', {
      method: 'POST',
      body: JSON.stringify({
        secret: 'kiln-secret',
        skip_dedupe: true,
        events: [{ athlete_id: 'i101', type: 'ACTIVITY_UPLOADED', activity: { id: 'a-1' } }],
      }),
    });
  }

  it('sends a legacy Android token two messages and a verified one one', async () => {
    const env = makeEnv();
    env.DEVICE_TOKENS.entries.set(
      'athlete:i101',
      JSON.stringify([
        { token: 'ExponentPushToken[old]', platform: 'android', registeredAt: 'x', legacy: true },
        { token: 'ExponentPushToken[new]', platform: 'android', registeredAt: 'x', legacy: false },
      ])
    );
    expect((await worker.fetch(webhook(), env)).status).toBe(200);
    const pushes = expoPushes();
    expect(pushes.filter((p) => p.to === 'ExponentPushToken[old]')).toHaveLength(2);
    expect(pushes.filter((p) => p.to === 'ExponentPushToken[new]')).toEqual([
      expect.objectContaining({ _contentAvailable: true }),
    ]);
  });

  /// Every row stored before the flag existed came from a registration with no
  /// credential, so it keeps the shape it was getting.
  it('treats a row stored before the flag existed as legacy', async () => {
    const env = makeEnv();
    env.DEVICE_TOKENS.entries.set(
      'athlete:i101',
      JSON.stringify([{ token: TOKEN, platform: 'android', registeredAt: 'x' }])
    );
    await worker.fetch(webhook(), env);
    expect(expoPushes()).toHaveLength(2);
    expect(expoPushes()[0]).toEqual(expect.objectContaining({ title: 'Activity Recorded' }));
  });
});
