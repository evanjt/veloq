const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const PUSH_TOKEN = 'ExponentPushToken[shared-phone]';
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
