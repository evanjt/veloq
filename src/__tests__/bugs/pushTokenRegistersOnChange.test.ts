/**
 * Scenario: launch POSTed the same push token to auth.veloq.fit on every app
 * open. The record lives 30 days and a refresh path already throttles to once a
 * day, so every open past the first was a wasted network write.
 *
 * Expected behaviour: a token the server has not been told about goes up at
 * once; an unchanged one falls through to the daily refresh.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ensurePushTokenRegistered,
  getExpoPushToken,
} from '@/features/settings/lib/pushTokenRegistration';

jest.mock('expo-notifications', () => ({ getExpoPushTokenAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'p' } } } }));
jest.mock('@/shared/app/AuthStore', () => ({
  getStoredCredentials: () => ({ authMethod: 'apiKey', apiKey: 'k', accessToken: null }),
}));

const Notifications = require('expo-notifications');

const ATHLETE = 'i350768';
const DAY_MS = 24 * 60 * 60 * 1000;

function tokenIs(value: string) {
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: value });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  tokenIs('ExponentPushToken[aaa]');
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
});

it('registers the first time, when the server has been told nothing', async () => {
  await ensurePushTokenRegistered(ATHLETE);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('makes no call on the next open with the same token', async () => {
  await ensurePushTokenRegistered(ATHLETE);
  (global.fetch as jest.Mock).mockClear();

  await ensurePushTokenRegistered(ATHLETE);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('registers again when the device token has changed', async () => {
  await ensurePushTokenRegistered(ATHLETE);
  (global.fetch as jest.Mock).mockClear();

  tokenIs('ExponentPushToken[bbb]');
  await ensurePushTokenRegistered(ATHLETE);

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
  expect(body.token).toBe('ExponentPushToken[bbb]');
});

it('still refreshes an unchanged token once the day is up', async () => {
  await ensurePushTokenRegistered(ATHLETE);
  (global.fetch as jest.Mock).mockClear();

  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + DAY_MS + 1);
  await ensurePushTokenRegistered(ATHLETE);
  jest.spyOn(Date, 'now').mockRestore();

  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('writes nothing down when the registration is refused', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
  await ensurePushTokenRegistered(ATHLETE);
  (global.fetch as jest.Mock).mockClear();

  await ensurePushTokenRegistered(ATHLETE);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('does nothing at all when the device has no token to offer', async () => {
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(new Error('no token'));
  await ensurePushTokenRegistered(ATHLETE);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(await getExpoPushToken()).toBeNull();
});
