const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const DEAD = { token: 'ExponentPushToken[dead]', platform: 'android', registeredAt: '2026-09-01' };
const PHONE_A = {
  token: 'ExponentPushToken[phone-a]',
  platform: 'android',
  registeredAt: '2026-09-02',
};
const PHONE_B = {
  token: 'ExponentPushToken[phone-b]',
  platform: 'android',
  registeredAt: '2026-09-03',
};

describe('webhook dead-token pruning', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([
    ['another existing token survives', [DEAD, PHONE_A]],
    ['the dead token was the only one initially', [DEAD]],
  ])('keeps a registration made during a push when %s', async (_case, initial) => {
    let stored: string | null = JSON.stringify(initial);
    let registered = false;
    const tokens = {
      get: jest.fn(async () => (stored ? JSON.parse(stored) : null)),
      put: jest.fn(async (_key: string, value: string) => {
        stored = value;
      }),
      delete: jest.fn(async () => {
        stored = null;
      }),
    };
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const pushed = JSON.parse(String(init?.body)) as { to: string };
      if (!registered) {
        registered = true;
        stored = JSON.stringify([...JSON.parse(stored as string), PHONE_B]);
      }
      const data =
        pushed.to === DEAD.token
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok' };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof fetch;

    const env = {
      WEBHOOK_SECRET: 'test-secret',
      DEVICE_TOKENS: tokens,
      OAUTH_STATES: {},
    } as unknown as Parameters<typeof worker.fetch>[1];
    const request = new Request('https://auth.veloq.fit/webhook/intervals', {
      method: 'POST',
      body: JSON.stringify({
        secret: 'test-secret',
        skip_dedupe: true,
        events: [
          { athlete_id: 'athlete-1', type: 'ACTIVITY_UPLOADED', activity: { id: 'ride-1' } },
        ],
      }),
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect((JSON.parse(stored as string) as typeof initial).map((device) => device.token)).toEqual(
      [...initial.filter((device) => device.token !== DEAD.token), PHONE_B].map(
        (device) => device.token
      )
    );
    expect(tokens.get).toHaveBeenCalledTimes(2);
    expect(tokens.delete).not.toHaveBeenCalled();
  });
});
