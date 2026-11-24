const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const PUSH_TOKEN = 'ExponentPushToken[shared-phone]';
const originalFetch = global.fetch;

function memoryKv() {
  const entries = new Map<string, string>();
  const expiries = new Map<string, number>();
  return {
    entries,
    get: jest.fn(async (key: string, format?: string) => {
      if ((expiries.get(key) ?? Infinity) <= Date.now()) {
        entries.delete(key);
        expiries.delete(key);
      }
      const value = entries.get(key) ?? null;
      return format === 'json' && value ? JSON.parse(value) : value;
    }),
    put: jest.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      entries.set(key, value);
      if (options?.expirationTtl) expiries.set(key, Date.now() + options.expirationTtl * 1000);
      else expiries.delete(key);
    }),
    delete: jest.fn(async (key: string) => {
      entries.delete(key);
    }),
  };
}

function makeEnv() {
  const tokens = memoryKv();
  global.fetch = jest.fn(async (_url, init) => {
    const authorization = (init?.headers as { Authorization: string }).Authorization;
    return new Response(JSON.stringify({ id: authorization.slice('Bearer '.length) }));
  }) as typeof fetch;
  return { DEVICE_TOKENS: tokens, OAUTH_STATES: {} };
}

function deviceRequest(athleteId: string, method: 'POST' | 'DELETE', token = PUSH_TOKEN) {
  const path = method === 'POST' ? 'register' : 'unregister';
  return new Request(`https://auth.veloq.fit/devices/${path}`, {
    method,
    headers: { Authorization: `Bearer ${athleteId}` },
    body: JSON.stringify({ athleteId, token, platform: 'android' }),
  });
}

describe('device token ownership', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('moves a shared token to the athlete who registers it next', async () => {
    const env = makeEnv();
    const tokens = env.DEVICE_TOKENS;
    expect((await worker.fetch(deviceRequest('i101', 'POST'), env)).status).toBe(200);
    expect((await worker.fetch(deviceRequest('i202', 'POST'), env)).status).toBe(200);
    expect(JSON.parse(tokens.entries.get('athlete:i101') ?? '[]')).toEqual([]);
    expect(JSON.parse(tokens.entries.get('athlete:i202') ?? '[]')).toEqual([
      expect.objectContaining({ token: PUSH_TOKEN }),
    ]);
    expect(tokens.entries.get(`token:${PUSH_TOKEN}`)).toBe('i202');
  });

  it('keeps the new owner when the previous athlete unregisters late', async () => {
    const env = makeEnv();
    const tokens = env.DEVICE_TOKENS;
    await worker.fetch(deviceRequest('i101', 'POST'), env);
    await worker.fetch(deviceRequest('i202', 'POST'), env);

    expect((await worker.fetch(deviceRequest('i101', 'DELETE'), env)).status).toBe(200);
    expect(tokens.entries.get(`token:${PUSH_TOKEN}`)).toBe('i202');
    expect(JSON.parse(tokens.entries.get('athlete:i202') ?? '[]')).toEqual([
      expect.objectContaining({ token: PUSH_TOKEN }),
    ]);
  });

  it('clears the owner index when the owning athlete unregisters', async () => {
    const env = makeEnv();
    const tokens = env.DEVICE_TOKENS;
    await worker.fetch(deviceRequest('i101', 'POST'), env);

    expect((await worker.fetch(deviceRequest('i101', 'DELETE'), env)).status).toBe(200);
    expect(tokens.entries.has(`token:${PUSH_TOKEN}`)).toBe(false);
    expect(tokens.entries.has('athlete:i101')).toBe(false);
  });

  it('clears the owner index when the athlete token cap drops a device', async () => {
    const env = makeEnv();
    const tokens = env.DEVICE_TOKENS;
    for (let index = 0; index < 11; index++) {
      const token = `ExponentPushToken[phone-${index}]`;
      expect((await worker.fetch(deviceRequest('i101', 'POST', token), env)).status).toBe(200);
    }

    expect(tokens.entries.has('token:ExponentPushToken[phone-0]')).toBe(false);
    expect(JSON.parse(tokens.entries.get('athlete:i101') ?? '[]')).toHaveLength(10);
  });
});

describe('device token age', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const START = Date.UTC(2026, 0, 1);
  const NEWER_TOKEN = 'ExponentPushToken[second-phone]';

  beforeEach(() => {
    jest.useFakeTimers({ now: START });
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function atDay(day: number) {
    jest.setSystemTime(START + day * DAY_MS);
  }

  function uploadEvent(athleteId: string) {
    return new Request('https://auth.veloq.fit/webhook/intervals', {
      method: 'POST',
      body: JSON.stringify({
        secret: 'hook-secret',
        skip_dedupe: true,
        events: [{ athlete_id: athleteId, type: 'ACTIVITY_UPLOADED', activity: { id: 'a1' } }],
      }),
    });
  }

  async function pushedTokens(env: ReturnType<typeof makeEnv>, athleteId: string) {
    const sent: string[] = [];
    const deviceFetch = global.fetch;
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).includes('exp.host')) {
        const messages = [JSON.parse(String(init?.body))].flat() as { to: string }[];
        for (const message of messages) sent.push(message.to);
        return new Response(JSON.stringify({ data: { status: 'ok' } }));
      }
      return deviceFetch(url, init);
    }) as typeof fetch;
    const response = await worker.fetch(uploadEvent(athleteId), {
      ...env,
      WEBHOOK_SECRET: 'hook-secret',
    });
    expect(response.status).toBe(200);
    return new Set(sent);
  }

  it('sends nothing to a token whose registration is older than the lifetime', async () => {
    const env = makeEnv();
    await worker.fetch(deviceRequest('i101', 'POST'), env);
    atDay(25);
    await worker.fetch(deviceRequest('i101', 'POST', NEWER_TOKEN), env);
    atDay(31);

    expect(await pushedTokens(env, 'i101')).toEqual(new Set([NEWER_TOKEN]));
  });

  it('drops a lapsed token from its row when another athlete registers it', async () => {
    const env = makeEnv();
    const tokens = env.DEVICE_TOKENS;
    await worker.fetch(deviceRequest('i101', 'POST'), env);
    atDay(25);
    await worker.fetch(deviceRequest('i101', 'POST', NEWER_TOKEN), env);
    atDay(31);
    await worker.fetch(deviceRequest('i202', 'POST'), env);

    expect(await pushedTokens(env, 'i101')).toEqual(new Set([NEWER_TOKEN]));
    expect(await pushedTokens(env, 'i202')).toEqual(new Set([PUSH_TOKEN]));

    atDay(32);
    await worker.fetch(deviceRequest('i101', 'POST', NEWER_TOKEN), env);
    const row = JSON.parse(tokens.entries.get('athlete:i101') ?? '[]') as { token: string }[];
    expect(row.map((entry) => entry.token)).toEqual([NEWER_TOKEN]);
  });

  it('keeps a token registered within the lifetime', async () => {
    const env = makeEnv();
    await worker.fetch(deviceRequest('i101', 'POST'), env);
    atDay(29);

    expect(await pushedTokens(env, 'i101')).toEqual(new Set([PUSH_TOKEN]));
  });
});
