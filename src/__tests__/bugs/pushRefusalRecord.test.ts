const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
  scheduled: (controller: unknown, env: unknown, ctx?: unknown) => Promise<void>;
};

/**
 * Scenario: Expo refuses a push for a reason other than an unregistered
 * device, such as a missing platform credential, either on the ticket it
 * answers the send with or on the receipt it hands over later.
 * Expected behaviour: every refusal is logged with its code, message, platform
 * and legacy flag and never the token or the athlete; a sent ticket is kept so
 * a scheduled run reads its receipt; a receipt naming an unregistered device
 * prunes the token; a receipt fetch that fails leaves the tickets for the next
 * run.
 */

const ATHLETE = 'i40417';
const TOKEN = 'ExponentPushToken[quarryLantern77]';
const SECOND_TOKEN = 'ExponentPushToken[harbourKite12]';

interface Stored {
  value: string;
  metadata?: unknown;
}

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map<string, Stored>(
    Object.entries(initial).map(([key, value]) => [key, { value }])
  );
  return {
    values,
    get: jest.fn(async (key: string, type?: string) => {
      const entry = values.get(key);
      if (!entry) return null;
      return type === 'json' ? JSON.parse(entry.value) : entry.value;
    }),
    put: jest.fn(async (key: string, value: string, options?: { metadata?: unknown }) => {
      values.set(key, { value, metadata: options?.metadata });
    }),
    delete: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    list: jest.fn(async ({ prefix = '' }: { prefix?: string } = {}) => ({
      keys: [...values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([name, entry]) => ({ name, metadata: entry.metadata })),
      list_complete: true,
    })),
  };
}

const device = (token: string, platform: 'ios' | 'android', legacy = false) => ({
  token,
  platform,
  registeredAt: '2026-09-01',
  legacy,
});

function environment(devices: ReturnType<typeof device>[]) {
  return {
    WEBHOOK_SECRET: 'test-secret',
    OAUTH_STATES: memoryStore(),
    DEVICE_TOKENS: memoryStore({
      [`athlete:${ATHLETE}`]: JSON.stringify(devices),
      ...Object.fromEntries(devices.map((d) => [`token:${d.token}`, ATHLETE])),
    }),
  };
}

function delivery() {
  return new Request('https://auth.veloq.fit/webhook/intervals', {
    method: 'POST',
    body: JSON.stringify({
      secret: 'test-secret',
      events: [{ athlete_id: ATHLETE, type: 'ACTIVITY_UPLOADED', activity: { id: 'ride-310' } }],
    }),
  });
}

function logged(spy: jest.SpyInstance): string {
  return spy.mock.calls
    .map((call) => call.map((part: unknown) => JSON.stringify(part)).join(' '))
    .join('\n');
}

function refusals(spy: jest.SpyInstance) {
  return spy.mock.calls
    .map((call) => call[0])
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
    );
}

const storedTokens = (env: ReturnType<typeof environment>) =>
  env.DEVICE_TOKENS.values.get(`athlete:${ATHLETE}`)?.value ?? '';

const receiptKeys = (env: ReturnType<typeof environment>) =>
  [...env.DEVICE_TOKENS.values.keys()].filter((key) => key.startsWith('receipt:'));

describe('Expo push refusals', () => {
  const originalFetch = global.fetch;
  let errors: jest.SpyInstance;
  let logs: jest.SpyInstance;

  beforeEach(() => {
    errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    logs = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('logs a refused ticket with its code and platform and no token or athlete', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              status: 'error',
              message: `Unable to retrieve the FCM server key for the recipient's app. "${TOKEN}" was refused.`,
              details: { error: 'InvalidCredentials' },
            },
          }),
          { status: 200 }
        )
    ) as typeof fetch;
    const env = environment([device(TOKEN, 'android')]);

    const response = await worker.fetch(delivery(), env);

    expect(response.status).toBe(200);
    const [refusal] = refusals(errors);
    expect(refusal).toMatchObject({
      stage: 'ticket',
      error: 'InvalidCredentials',
      platform: 'android',
      legacy: false,
    });
    expect(String(refusal.message)).toContain('FCM server key');
    const everything = `${logged(errors)}\n${logged(logs)}`;
    expect(everything).not.toContain('quarryLantern77');
    expect(everything).not.toContain(ATHLETE);
    expect(storedTokens(env)).toContain(TOKEN);
  });

  it('logs a refused request answered with an error status without the token', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 'VALIDATION_ERROR', message: `"${TOKEN}" is not valid` }],
          }),
          {
            status: 400,
          }
        )
    ) as typeof fetch;
    const env = environment([device(TOKEN, 'ios', true)]);

    await worker.fetch(delivery(), env);

    expect(logged(errors)).toContain('VALIDATION_ERROR');
    expect(`${logged(errors)}\n${logged(logs)}`).not.toContain('quarryLantern77');
  });

  it('keeps each accepted ticket with its platform for the receipt check', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n += 1;
      return new Response(JSON.stringify({ data: { status: 'ok', id: `ticket-${n}` } }), {
        status: 200,
      });
    }) as typeof fetch;
    const env = environment([device(TOKEN, 'ios')]);

    await worker.fetch(delivery(), env);

    expect(receiptKeys(env).sort()).toEqual(['receipt:ticket-1', 'receipt:ticket-2']);
    const kept = env.DEVICE_TOKENS.values.get('receipt:ticket-1')!;
    expect(kept.metadata).toMatchObject({ platform: 'ios', legacy: false });
    const put = env.DEVICE_TOKENS.put.mock.calls.find(([key]) => key === 'receipt:ticket-1')!;
    expect(put[2]).toEqual(expect.objectContaining({ expirationTtl: expect.any(Number) }));
  });

  describe('the scheduled receipt check', () => {
    function withTickets(env: ReturnType<typeof environment>) {
      const keep = (id: string, token: string, platform: string) =>
        env.DEVICE_TOKENS.values.set(`receipt:${id}`, {
          value: '',
          metadata: { athleteId: ATHLETE, token, platform, legacy: false },
        });
      keep('ticket-apns', TOKEN, 'ios');
      keep('ticket-gone', SECOND_TOKEN, 'android');
      keep('ticket-pending', TOKEN, 'ios');
      keep('ticket-fine', SECOND_TOKEN, 'android');
    }

    it('logs each receipt error, prunes an unregistered device and keeps a receipt not yet ready', async () => {
      const env = environment([device(TOKEN, 'ios'), device(SECOND_TOKEN, 'android')]);
      withTickets(env);
      const asked: string[][] = [];
      global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://exp.host/--/api/v2/push/getReceipts');
        asked.push((JSON.parse(String(init?.body)) as { ids: string[] }).ids);
        return new Response(
          JSON.stringify({
            data: {
              'ticket-apns': {
                status: 'error',
                message: `The APNs key for "${TOKEN}" was revoked.`,
                details: { error: 'InvalidProviderToken' },
              },
              'ticket-gone': {
                status: 'error',
                message: `"${SECOND_TOKEN}" is not a registered push notification recipient`,
                details: { error: 'DeviceNotRegistered' },
              },
              'ticket-fine': { status: 'ok' },
            },
          }),
          { status: 200 }
        );
      }) as typeof fetch;

      await worker.scheduled({}, env);

      expect(asked.flat().sort()).toEqual([
        'ticket-apns',
        'ticket-fine',
        'ticket-gone',
        'ticket-pending',
      ]);
      expect(refusals(errors)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: 'receipt',
            error: 'InvalidProviderToken',
            platform: 'ios',
            legacy: false,
          }),
          expect.objectContaining({
            stage: 'receipt',
            error: 'DeviceNotRegistered',
            platform: 'android',
          }),
        ])
      );
      const everything = `${logged(errors)}\n${logged(logs)}`;
      expect(everything).not.toContain('quarryLantern77');
      expect(everything).not.toContain('harbourKite12');
      expect(everything).not.toContain(ATHLETE);
      expect(storedTokens(env)).toContain(TOKEN);
      expect(storedTokens(env)).not.toContain(SECOND_TOKEN);
      expect(env.DEVICE_TOKENS.values.has(`token:${SECOND_TOKEN}`)).toBe(false);
      expect(receiptKeys(env)).toEqual(['receipt:ticket-pending']);
    });

    it('leaves every ticket for the next run when the receipt fetch fails', async () => {
      const env = environment([device(TOKEN, 'ios'), device(SECOND_TOKEN, 'android')]);
      withTickets(env);
      global.fetch = jest.fn(async () => {
        throw new Error('network down');
      }) as typeof fetch;

      await worker.scheduled({}, env);

      expect(receiptKeys(env)).toHaveLength(4);
      expect(storedTokens(env)).toContain(SECOND_TOKEN);
    });

    it('leaves every ticket for the next run when Expo answers with an error status', async () => {
      const env = environment([device(TOKEN, 'ios'), device(SECOND_TOKEN, 'android')]);
      withTickets(env);
      global.fetch = jest.fn(async () => new Response('busy', { status: 503 })) as typeof fetch;

      await worker.scheduled({}, env);

      expect(receiptKeys(env)).toHaveLength(4);
    });

    it('asks Expo nothing when no ticket is waiting', async () => {
      const env = environment([device(TOKEN, 'ios')]);
      global.fetch = jest.fn() as unknown as typeof fetch;

      await worker.scheduled({}, env);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
