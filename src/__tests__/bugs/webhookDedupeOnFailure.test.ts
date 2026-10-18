const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

/**
 * Scenario: a transient store error fails one event of a webhook delivery
 * before its push is sent, and the sender delivers the same body again.
 * Expected behaviour: the first delivery answers 500, the events that did
 * succeed are pushed once, and the redelivery pushes the failed event.
 */

const device = (name: string) => ({
  token: `ExponentPushToken[${name}]`,
  platform: 'android',
  registeredAt: '2026-09-01',
  legacy: false,
});

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    put: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function tokenStore(byAthlete: Record<string, ReturnType<typeof device>[]>, failOnce: string[]) {
  const pending = new Set(failOnce);
  return {
    get: jest.fn(async (key: string) => {
      if (pending.delete(key)) throw new Error('store unavailable');
      const athlete = key.replace(/^athlete:/, '');
      return byAthlete[athlete] ?? null;
    }),
    put: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
  };
}

function delivery(athletes: string[]) {
  return new Request('https://auth.veloq.fit/webhook/intervals', {
    method: 'POST',
    body: JSON.stringify({
      secret: 'test-secret',
      events: athletes.map((athlete) => ({
        athlete_id: athlete,
        type: 'ACTIVITY_UPLOADED',
        activity: { id: `ride-of-${athlete}` },
      })),
    }),
  });
}

describe('webhook delivery after a transient failure', () => {
  const originalFetch = global.fetch;
  let pushedTo: string[];

  beforeEach(() => {
    pushedTo = [];
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      pushedTo.push((JSON.parse(String(init?.body)) as { to: string }).to);
      return new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('pushes the event on redelivery when its token read failed the first time', async () => {
    const env = {
      WEBHOOK_SECRET: 'test-secret',
      OAUTH_STATES: memoryStore(),
      DEVICE_TOKENS: tokenStore({ alice: [device('alice')] }, ['athlete:alice']),
    };

    const first = await worker.fetch(delivery(['alice']), env);
    expect(first.status).toBe(500);
    expect(pushedTo).toEqual([]);
    expect([...env.OAUTH_STATES.values.keys()]).toEqual([]);

    const second = await worker.fetch(delivery(['alice']), env);
    expect(second.status).toBe(200);
    expect(pushedTo).toEqual([device('alice').token]);
  });

  it('sends the other events of the batch once and only the failed one again', async () => {
    const env = {
      WEBHOOK_SECRET: 'test-secret',
      OAUTH_STATES: memoryStore(),
      DEVICE_TOKENS: tokenStore({ alice: [device('alice')], bruno: [device('bruno')] }, [
        'athlete:alice',
      ]),
    };

    const first = await worker.fetch(delivery(['alice', 'bruno']), env);
    expect(first.status).toBe(500);
    expect(pushedTo).toEqual([device('bruno').token]);

    const second = await worker.fetch(delivery(['alice', 'bruno']), env);
    expect(second.status).toBe(200);
    expect(pushedTo).toEqual([device('bruno').token, device('alice').token]);

    const third = await worker.fetch(delivery(['alice', 'bruno']), env);
    expect(third.status).toBe(200);
    expect(pushedTo).toHaveLength(2);
  });

  it('keeps an event seen once its push was sent even when the prune after it fails', async () => {
    const tokens = tokenStore({ alice: [device('alice')] }, []);
    let reads = 0;
    tokens.get.mockImplementation(async () => {
      reads += 1;
      if (reads > 1) throw new Error('store unavailable');
      return [device('alice')];
    });
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      pushedTo.push((JSON.parse(String(init?.body)) as { to: string }).to);
      return new Response(
        JSON.stringify({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }),
        { status: 200 }
      );
    }) as typeof fetch;
    const env = {
      WEBHOOK_SECRET: 'test-secret',
      OAUTH_STATES: memoryStore(),
      DEVICE_TOKENS: tokens,
    };

    const first = await worker.fetch(delivery(['alice']), env);
    expect(first.status).toBe(200);
    await worker.fetch(delivery(['alice']), env);
    expect(pushedTo).toEqual([device('alice').token]);
  });
});
