/**
 * Scenario: the push device endpoints took an athlete id out of the request
 * body and wrote against it with no authentication at all. Anyone who could
 * reach auth.veloq.fit could unregister another athlete's device, or register
 * their own push token against that athlete's id and receive notifications
 * carrying their activity names and figures.
 *
 * Expected behaviour: the caller proves which athlete it speaks for by handing
 * over the intervals.icu credential it already holds, which is resolved
 * against the API, and the body's athlete id has to be that athlete.
 */

import {
  authoriseDevice,
  credentialHeader,
  intervalsAthleteResolver,
  UpstreamRefusal,
} from '../../../oauth-proxy/src/deviceAuth';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getExpoPushTokenAsync: jest.fn(),
}));

const OWN = 'i900001';
const OTHER = 'i999999';

/** Stands in for intervals.icu: the credential names its athlete, nothing else does. */
const owner = async (header: string) =>
  header === 'Bearer token-of-own' || header === 'Basic a2V5' ? OWN : null;

describe('reading the credential off a request', () => {
  it('accepts OAuth and refuses a personal API key', () => {
    expect(credentialHeader('Bearer abc123')).toBe('Bearer abc123');
    expect(credentialHeader('Basic a2V5')).toBeNull();
  });

  it('accepts the scheme in any case, which is what RFC 7235 says', () => {
    expect(credentialHeader('bearer abc123')).toBe('bearer abc123');
  });

  it('trims, so a header with surrounding space is still forwarded', () => {
    expect(credentialHeader('  Bearer abc123  ')).toBe('Bearer abc123');
  });

  it('refuses a header with no scheme, another scheme, or nothing after it', () => {
    expect(credentialHeader('abc123')).toBeNull();
    expect(credentialHeader('Digest abc123')).toBeNull();
    expect(credentialHeader('Bearer ')).toBeNull();
    expect(credentialHeader('Bearer   ')).toBeNull();
    expect(credentialHeader(null)).toBeNull();
  });
});

describe('authorising a device registration', () => {
  it('lets an athlete write against their own id', async () => {
    await expect(authoriseDevice('Bearer token-of-own', OWN, owner)).resolves.toEqual({
      ok: true,
      athleteId: OWN,
    });
  });

  it('refuses personal API-key registration before resolving an athlete', async () => {
    const resolve = jest.fn(owner);
    await expect(authoriseDevice('Basic a2V5', OWN, resolve)).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Missing credential',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a token that resolves to a different athlete', async () => {
    const result = await authoriseDevice('Bearer token-of-own', OTHER, owner);
    expect(result).toEqual({ ok: false, status: 403, error: 'Athlete mismatch' });
  });

  it('refuses a request with no Authorization header', async () => {
    const result = await authoriseDevice(null, OWN, owner);
    expect(result).toEqual({ ok: false, status: 401, error: 'Missing credential' });
  });

  it('refuses a credential intervals.icu does not recognise', async () => {
    const result = await authoriseDevice('Bearer forged', OWN, owner);
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid credential' });
  });

  /// The resolver throws when intervals.icu is unreachable. An outage must not
  /// read as a valid caller.
  it('refuses when the athlete cannot be resolved at all', async () => {
    const unreachable = async () => {
      throw new Error('network down');
    };
    const result = await authoriseDevice('Bearer token-of-own', OWN, unreachable);
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid credential' });
  });

  /// intervals.icu refusing the lookup says nothing about the credential, so
  /// a device told 401 would treat a working sign-in as a bad one.
  it('answers a refused lookup with 429 and the wait intervals.icu asked for', async () => {
    const refused = async () => {
      throw new UpstreamRefusal('600');
    };
    const result = await authoriseDevice('Bearer token-of-own', OWN, refused);
    expect(result).toEqual({
      ok: false,
      status: 429,
      error: 'intervals.icu asked for a pause',
      retryAfter: '600',
    });
  });

  it('reads a 429 from intervals.icu as a refusal, not as no athlete', async () => {
    const fetchImpl = (async () =>
      new Response('', { status: 429, headers: { 'Retry-After': '120' } })) as typeof fetch;
    await expect(intervalsAthleteResolver(fetchImpl)('Bearer token-of-own')).rejects.toEqual(
      new UpstreamRefusal('120')
    );
  });

  it('reads a 401 from intervals.icu as no athlete', async () => {
    const fetchImpl = (async () => new Response('', { status: 401 })) as typeof fetch;
    await expect(intervalsAthleteResolver(fetchImpl)('Bearer forged')).resolves.toBeNull();
  });

  it('resolves the token once, not once per field it checks', async () => {
    const spy = jest.fn(owner);
    await authoriseDevice('Bearer token-of-own', OWN, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the header the app sends with a device registration', () => {
  const { authorizationHeader } = require('@/features/settings/lib/pushTokenRegistration');

  it('is a bearer for an OAuth sign-in', () => {
    expect(authorizationHeader({ authMethod: 'oauth', accessToken: 'tok', apiKey: null })).toBe(
      'Bearer tok'
    );
  });

  it('never sends a personal API key to the push worker', () => {
    const header = authorizationHeader({
      authMethod: 'apiKey',
      accessToken: null,
      apiKey: 'secret',
    });
    expect(header).toBeNull();
  });

  it('is nothing when there is no credential to send', () => {
    expect(authorizationHeader({ authMethod: null, accessToken: null, apiKey: null })).toBeNull();
    expect(
      authorizationHeader({ authMethod: 'oauth', accessToken: '  ', apiKey: null })
    ).toBeNull();
  });
});

it('does not request a push token or contact the worker for an API-key session', async () => {
  const { registerPushToken } = require('@/features/settings/lib/pushTokenRegistration');
  const { useAuthStore } = require('@/shared/app/AuthStore');
  const notifications = require('expo-notifications');
  useAuthStore.setState({ authMethod: 'apiKey', apiKey: 'secret', accessToken: null });
  const tokenRequest = notifications.getExpoPushTokenAsync as jest.Mock;
  tokenRequest.mockClear();
  const oldFetch = global.fetch;
  const workerRequest = jest.fn();
  global.fetch = workerRequest;
  try {
    await expect(registerPushToken(OWN)).resolves.toBe(false);
    expect(tokenRequest).not.toHaveBeenCalled();
    expect(workerRequest).not.toHaveBeenCalled();
  } finally {
    global.fetch = oldFetch;
  }
});

it('uses the OAuth credential held when unregister begins', async () => {
  const { unregisterPushToken } = require('@/features/settings/lib/pushTokenRegistration');
  const { useAuthStore } = require('@/shared/app/AuthStore');
  const notifications = require('expo-notifications');
  let deliverToken: (value: { data: string }) => void = () => {};
  notifications.getExpoPushTokenAsync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        deliverToken = resolve;
      })
  );
  useAuthStore.setState({ authMethod: 'oauth', accessToken: 'live-token', athleteId: OWN });
  const oldFetch = global.fetch;
  const workerRequest = jest.fn(async () => new Response('', { status: 200 }));
  global.fetch = workerRequest;
  try {
    const unregistering = unregisterPushToken(OWN);
    await Promise.resolve();
    useAuthStore.setState({ authMethod: null, accessToken: null, athleteId: null });
    deliverToken({ data: 'ExpoPushToken[test]' });
    await expect(unregistering).resolves.toBe(true);
    expect(workerRequest).toHaveBeenCalledWith(
      expect.stringContaining('/devices/unregister'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer live-token' }),
      })
    );
  } finally {
    global.fetch = oldFetch;
  }
});

it('does not register a token after the OAuth session ends during token lookup', async () => {
  const { registerPushToken } = require('@/features/settings/lib/pushTokenRegistration');
  const { useAuthStore } = require('@/shared/app/AuthStore');
  const notifications = require('expo-notifications');
  let deliverToken: (value: { data: string }) => void = () => {};
  notifications.getExpoPushTokenAsync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        deliverToken = resolve;
      })
  );
  useAuthStore.setState({ authMethod: 'oauth', accessToken: 'live-token', athleteId: OWN });
  const oldFetch = global.fetch;
  const workerRequest = jest.fn();
  global.fetch = workerRequest;
  try {
    const registering = registerPushToken(OWN);
    await Promise.resolve();
    useAuthStore.setState({ authMethod: null, accessToken: null, athleteId: null });
    deliverToken({ data: 'ExpoPushToken[test]' });
    await expect(registering).resolves.toBe(false);
    expect(workerRequest).not.toHaveBeenCalled();
  } finally {
    global.fetch = oldFetch;
  }
});

/**
 * Scenario: the device routes forward the caller's credential to intervals.icu
 * on every request, so with no limit in front of them one address can make the
 * proxy send any volume of lookups from the egress real registrations share.
 *
 * Expected behaviour: each address has a per-route budget on the device routes,
 * spent before the credential is looked up, apart from the sign-in routes' own.
 */
describe('the device routes rate-limit each address before the lookup', () => {
  const worker = require('../../../oauth-proxy/src/worker').default as {
    fetch: (request: Request, env: unknown) => Promise<Response>;
  };
  const BUDGET = 10;
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

  let lookups: jest.Mock;

  function makeEnv() {
    lookups = jest.fn(async () => new Response(JSON.stringify({ id: OWN })));
    global.fetch = lookups as unknown as typeof fetch;
    return { DEVICE_TOKENS: memoryKv(), OAUTH_STATES: memoryKv() };
  }

  function deviceRequest(method: 'POST' | 'DELETE', ip = '203.0.113.7') {
    const path = method === 'POST' ? 'register' : 'unregister';
    return new Request(`https://auth.veloq.fit/devices/${path}`, {
      method,
      headers: { Authorization: 'Bearer guessed', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ athleteId: OWN, token: 'ExponentPushToken[x]', platform: 'android' }),
    });
  }

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each(['POST', 'DELETE'] as const)(
    'answers %s past the budget with 429 and no intervals.icu request',
    async (method) => {
      const env = makeEnv();
      for (let i = 0; i < BUDGET; i++) {
        expect((await worker.fetch(deviceRequest(method), env)).status).toBe(200);
      }
      const refused = await worker.fetch(deviceRequest(method), env);
      expect(refused.status).toBe(429);
      expect(refused.headers.get('Retry-After')).toBe('60');
      expect(lookups).toHaveBeenCalledTimes(BUDGET);
    }
  );

  it('counts each address on its own', async () => {
    const env = makeEnv();
    for (let i = 0; i < BUDGET; i++) await worker.fetch(deviceRequest('POST'), env);
    expect((await worker.fetch(deviceRequest('POST', '198.51.100.2'), env)).status).toBe(200);
  });

  it('still lets the sign-out unregister through after registrations spent their budget', async () => {
    const env = makeEnv();
    for (let i = 0; i < BUDGET + 1; i++) await worker.fetch(deviceRequest('POST'), env);
    expect((await worker.fetch(deviceRequest('DELETE'), env)).status).toBe(200);
  });

  it('leaves the sign-in budget untouched', async () => {
    const env = makeEnv();
    for (let i = 0; i < BUDGET + 1; i++) await worker.fetch(deviceRequest('POST'), env);
    const state = await worker.fetch(
      new Request('https://auth.veloq.fit/oauth/state', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '203.0.113.7' },
        body: JSON.stringify({ state: 'x'.repeat(43), code_challenge: 'y'.repeat(43) }),
      }),
      env
    );
    expect(state.status).not.toBe(429);
  });
});
