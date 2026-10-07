import { stateKey } from '../../../oauth-proxy/src/keys';

const worker = require('../../../oauth-proxy/src/worker').default;

const state = '0123456789abcdef0123456789abcdef';
const originalFetch = global.fetch;

function callbackEnv() {
  const entries = new Map([[stateKey(state), 'valid']]);
  return {
    INTERVALS_CLIENT_ID: 'client',
    INTERVALS_CLIENT_SECRET: 'secret',
    OAUTH_STATES: {
      get: jest.fn(async (key: string) => entries.get(key) ?? null),
      delete: jest.fn(async (key: string) => {
        entries.delete(key);
      }),
      put: jest.fn(async (key: string, value: string) => {
        entries.set(key, value);
      }),
    },
  };
}

async function callbackResponse(env = callbackEnv()): Promise<Response> {
  const url = `https://auth.veloq.fit/oauth/callback?code=code&state=${state}`;
  return worker.fetch(new Request(url), env as never);
}

async function expectAppError(response: Response, code = 'token_exchange_failed'): Promise<void> {
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/html');
  expect(await response.text()).toContain(`veloq://oauth/callback?success=false&error=${code}`);
}

afterEach(() => {
  global.fetch = originalFetch;
});

it('returns an app error redirect when the token request rejects', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
  const response = await callbackResponse();
  await expectAppError(response);
});

it('returns an app error redirect when the token response is not JSON', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
  const response = await callbackResponse();
  await expectAppError(response);
});

it('returns an app error redirect when the state read fails', async () => {
  global.fetch = jest.fn();
  const env = callbackEnv();
  env.OAUTH_STATES.get.mockRejectedValue(new Error('KV unavailable'));
  const response = await callbackResponse(env);
  await expectAppError(response, 'server_error');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('returns an app error redirect when the state delete fails', async () => {
  global.fetch = jest.fn();
  const env = callbackEnv();
  env.OAUTH_STATES.delete.mockRejectedValue(new Error('KV unavailable'));
  const response = await callbackResponse(env);
  await expectAppError(response, 'server_error');
  expect(global.fetch).not.toHaveBeenCalled();
});
