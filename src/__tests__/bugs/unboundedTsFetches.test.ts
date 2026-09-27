/**
 * Scenario: a connection that accepts the handshake and answers nothing. The
 * requests that stay in TypeScript had no deadline, so sign-in, the push token
 * registration and a WebDAV backup waited on the platform socket timeout.
 *
 * Expected behaviour: each one gives up at its ceiling and says what happened.
 * Asserted with fake timers, so the test measures the deadline rather than
 * waiting on it.
 */

import {
  registerPushToken,
  unregisterPushToken,
} from '@/features/settings/lib/pushTokenRegistration';
import { testWebdavConnection } from '@/features/settings/lib/autobackup/backends/webdavBackend';
import { NET_DEADLINE_MS } from '@/shared/net/fetchWithDeadline';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  multiSet: jest.fn(async () => undefined),
  multiGet: jest.fn(async () => []),
  multiRemove: jest.fn(async () => undefined),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ authMethod: 'apiKey' }) },
  getStoredCredentials: () => ({ apiKey: 'key', accessToken: null, authMethod: 'apiKey' }),
}));
jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  getWebdavConfig: () => ({ url: 'https://nas.example/dav', username: 'u', password: 'p' }),
  webdavConfigProblem: () => null,
  webdavUrlProblemMessage: () => 'bad url',
  normalizeWebdavUrl: (url: string) => url,
}));

/** A socket that is open and silent: it answers only the abort. */
function hungFetch(): jest.Mock {
  return jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      })
  );
}

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

describe('a request that never answers', () => {
  it('does not hold the push token registration open', async () => {
    const send = hungFetch();
    global.fetch = send as never;
    jest.useFakeTimers();

    const registered = registerPushToken('i1');
    await jest.advanceTimersByTimeAsync(NET_DEADLINE_MS.interactive);

    await expect(registered).resolves.toBe(false);
    expect(send).toHaveBeenCalled();
  });

  it('does not hold the unregister open either, which every sign-out waits on', async () => {
    const send = hungFetch();
    global.fetch = send as never;
    jest.useFakeTimers();

    const unregistered = unregisterPushToken('i1');
    await jest.advanceTimersByTimeAsync(NET_DEADLINE_MS.interactive);

    await expect(unregistered).resolves.toBe(false);
    expect(send).toHaveBeenCalled();
  });

  it('answers the WebDAV connection test with a failure rather than a spinner', async () => {
    global.fetch = hungFetch() as never;
    jest.useFakeTimers();

    const tested = testWebdavConnection();
    await jest.advanceTimersByTimeAsync(NET_DEADLINE_MS.interactive);

    await expect(tested).resolves.toMatch(/timed out/i);
  });
});
