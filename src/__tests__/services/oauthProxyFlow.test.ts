/**
 * Scenario: sign-in goes through the proxy worker. The app registers a state
 * and a PKCE challenge, intervals.icu redirects back with a code, the worker
 * parks that code under a one-time code, and the app redeems it with the
 * verifier, which is when the worker exchanges it for the token. The webhook route is public and guarded by a shared secret.
 *
 * Expected behaviour: the redirect carries a code and never the token; a code
 * is spent by its first use; a refusal never says which half was wrong; no
 * client-supplied state can name another kind of key; the webhook refuses a
 * wrong secret.
 */

import { codeChallengeFor } from '../../../oauth-proxy/src/pkce';
import * as secrets from '../../../oauth-proxy/src/secrets';

const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const VERIFIER = 'v'.repeat(43);
const STATE = 's'.repeat(32);
const TOKEN = {
  token_type: 'Bearer',
  access_token: 'secret-bearer-token',
  scope: 'ACTIVITY:READ',
  athlete: { id: 'i42', name: 'Test Athlete' },
};
const BASE = 'https://auth.veloq.fit';
const originalFetch = global.fetch;

function memoryKv() {
  const entries = new Map<string, string>();
  return {
    entries,
    get: jest.fn(async (key: string) => entries.get(key) ?? null),
    put: jest.fn(async (key: string, value: string) => {
      entries.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      entries.delete(key);
    }),
  };
}

function makeEnv() {
  return {
    INTERVALS_CLIENT_ID: 'client',
    INTERVALS_CLIENT_SECRET: 'client-secret',
    WEBHOOK_SECRET: 'webhook-secret-value',
    OAUTH_STATES: memoryKv(),
    DEVICE_TOKENS: memoryKv(),
  };
}

const post = (path: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body) });

async function registerState(env: ReturnType<typeof makeEnv>, state = STATE, challenge?: string) {
  const response = await worker.fetch(
    post('/oauth/state', { state, code_challenge: challenge }),
    env
  );
  expect(response.status).toBe(200);
}

async function callback(env: ReturnType<typeof makeEnv>, state = STATE): Promise<URLSearchParams> {
  global.fetch = jest
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(TOKEN), { status: 200 })) as typeof fetch;
  const response = await worker.fetch(
    new Request(`${BASE}/oauth/callback?code=ic-code&state=${state}`),
    env
  );
  const html = await response.text();
  const link = /veloq:\/\/oauth\/callback\?([^"<]+)/.exec(html);
  expect(link).not.toBeNull();
  return new URLSearchParams(link![1].replace(/&amp;/g, '&'));
}

const redeem = (env: ReturnType<typeof makeEnv>, code: string, verifier: string) => {
  if (!jest.isMockFunction(global.fetch)) {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(TOKEN), { status: 200 })) as typeof fetch;
  }
  return worker.fetch(post('/oauth/token', { code, code_verifier: verifier }), env);
};

async function signedInCode(env: ReturnType<typeof makeEnv>): Promise<string> {
  await registerState(env, STATE, await codeChallengeFor(VERIFIER));
  const params = await callback(env);
  return params.get('code')!;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('the redirect back to the app', () => {
  it('carries a one-time code and not the access token when a challenge was registered', async () => {
    const env = makeEnv();
    await registerState(env, STATE, await codeChallengeFor(VERIFIER));

    const params = await callback(env);

    expect(params.get('code')).toBeTruthy();
    expect(params.get('state')).toBe(STATE);
    expect(params.has('access_token')).toBe(false);
    expect([...params.values()].join(' ')).not.toContain(TOKEN.access_token);
  });

  it('carries the token only for a build that registered no challenge', async () => {
    const env = makeEnv();
    await registerState(env);

    const params = await callback(env);

    expect(params.get('access_token')).toBe(TOKEN.access_token);
    expect(params.has('code')).toBe(false);
  });
});

describe('what the worker holds between the callback and the redemption', () => {
  it("is intervals.icu's code and never the token, and makes no upstream call", async () => {
    const env = makeEnv();
    await registerState(env, STATE, await codeChallengeFor(VERIFIER));

    await callback(env);

    expect(global.fetch).not.toHaveBeenCalled();
    const held = [...env.OAUTH_STATES.entries.values()].join(' ');
    expect(held).not.toContain(TOKEN.access_token);
    expect(held).not.toContain(TOKEN.athlete.name);
    expect(held).toContain('ic-code');
  });
});

describe('redeeming the code', () => {
  it("exchanges intervals.icu's code once, only after the verifier matched", async () => {
    const env = makeEnv();
    const code = await signedInCode(env);
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(TOKEN), { status: 200 })) as typeof fetch;

    expect((await redeem(env, code, VERIFIER)).status).toBe(200);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://intervals.icu/api/oauth/token');
    expect(new URLSearchParams(init.body).get('code')).toBe('ic-code');
  });

  it('makes no upstream call for a wrong verifier', async () => {
    const env = makeEnv();
    const code = await signedInCode(env);
    global.fetch = jest.fn() as typeof fetch;

    expect((await redeem(env, code, 'w'.repeat(43))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['the request rejects', () => jest.fn().mockRejectedValue(new Error('down'))],
    [
      'the answer is not ok',
      () => jest.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    ],
    [
      'the body is not JSON',
      () => jest.fn().mockResolvedValue(new Response('<html>', { status: 200 })),
    ],
    [
      'the athlete id is missing',
      () =>
        jest
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ access_token: 'leaky-token' }), { status: 200 })
          ),
    ],
  ])('answers 502 without a token and spends the code when %s', async (_case, upstream) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = makeEnv();
    const code = await signedInCode(env);
    global.fetch = upstream() as typeof fetch;

    const failed = await redeem(env, code, VERIFIER);

    expect(failed.status).toBe(502);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    const text = await failed.text();
    expect(text).not.toContain('leaky-token');
    expect(JSON.parse(text)).toEqual({ error: 'token_exchange_failed' });
    expect((await redeem(env, code, VERIFIER)).status).toBe(400);
  });

  it('hands the token back to the holder of the verifier, uncached', async () => {
    const env = makeEnv();
    const code = await signedInCode(env);

    const response = await redeem(env, code, VERIFIER);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      success: true,
      access_token: TOKEN.access_token,
      athlete_id: 'i42',
    });
  });

  it('works once', async () => {
    const env = makeEnv();
    const code = await signedInCode(env);

    expect((await redeem(env, code, VERIFIER)).status).toBe(200);
    expect((await redeem(env, code, VERIFIER)).status).toBe(400);
  });

  it('spends the code on a wrong verifier, so a guess cannot be retried', async () => {
    const env = makeEnv();
    const code = await signedInCode(env);

    expect((await redeem(env, code, 'w'.repeat(43))).status).toBe(400);
    expect((await redeem(env, code, VERIFIER)).status).toBe(400);
  });

  it('answers a wrong verifier, an unknown code and a malformed request without a token', async () => {
    const env = makeEnv();
    const code = await signedInCode(env);

    const wrongVerifier = await redeem(env, code, 'w'.repeat(43));
    const unknownCode = await redeem(env, 'no-such-code', VERIFIER);
    const badVerifier = await redeem(env, 'no-such-code', 'short');

    for (const refusal of [wrongVerifier, unknownCode, badVerifier]) {
      expect(refusal.status).toBe(400);
      expect(refusal.headers.get('Cache-Control')).toBe('no-store');
      expect(JSON.stringify(await refusal.clone().json())).not.toContain(TOKEN.access_token);
    }
    expect(await wrongVerifier.json()).toEqual(await unknownCode.json());
  });

  it('refuses a body that is not JSON', async () => {
    const response = await worker.fetch(
      new Request(`${BASE}/oauth/token`, { method: 'POST', body: 'not json' }),
      makeEnv()
    );
    expect(response.status).toBe(400);
  });
});

describe('the keys one namespace holds', () => {
  it('gives every key a prefix naming its kind, whatever state the client chooses', async () => {
    const env = makeEnv();
    const hostile = ['rate:1.2.3.4', 'dedup:i1:ACTIVITY_UPLOADED:9', 'exchange:xyz'].map(
      (prefix) => `${prefix}${'z'.repeat(32)}`
    );

    for (const state of hostile) await registerState(env, state);

    const keys = [...env.OAUTH_STATES.entries.keys()].filter((k) => !k.startsWith('rate:'));
    expect(keys).toHaveLength(hostile.length);
    for (const key of keys) expect(key).toMatch(/^state:/);
    for (const state of hostile) expect(env.OAUTH_STATES.entries.has(state)).toBe(false);
  });

  it('cannot be used to read a parked exchange as a state', async () => {
    const env = makeEnv();
    const code = await signedInCode(env);

    const params = await callback(env, `exchange:${code}`);

    expect(params.get('error')).toBe('invalid_state');
  });
});

describe('a malformed token response', () => {
  it('is logged by its shape, never by its contents', async () => {
    const env = makeEnv();
    await registerState(env);
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'leaky-token' }), { status: 200 })
      ) as typeof fetch;

    await worker.fetch(new Request(`${BASE}/oauth/callback?code=c&state=${STATE}`), env);

    expect(JSON.stringify(logged.mock.calls)).not.toContain('leaky-token');
  });
});

describe('the webhook', () => {
  const webhook = (env: ReturnType<typeof makeEnv>, secret: unknown) =>
    worker.fetch(post('/webhook/intervals', { secret, events: [] }), env);

  it('accepts its shared secret', async () => {
    expect((await webhook(makeEnv(), 'webhook-secret-value')).status).toBe(200);
  });

  it.each([
    ['a wrong secret of the same length', 'webhook-secret-valuX'],
    ['a secret sharing only its opening', 'webhook-'],
    ['an empty string', ''],
    ['no secret', undefined],
    ['a non-string', { length: 20 }],
  ])('refuses %s', async (_case, secret) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await webhook(makeEnv(), secret)).status).toBe(401);
  });

  it('decides through the constant-time comparison, whose verdict it obeys', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const compare = jest.spyOn(secrets, 'secretsMatch').mockResolvedValue(false);

    const refused = await webhook(makeEnv(), 'webhook-secret-value');

    expect(compare).toHaveBeenCalledWith('webhook-secret-value', 'webhook-secret-value');
    expect(refused.status).toBe(401);
  });
});
