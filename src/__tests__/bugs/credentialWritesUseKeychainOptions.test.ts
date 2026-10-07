/**
 * Scenario: a credential written without the shared access group and the
 * after-first-unlock attribute lands in the app's own group, where a
 * notification extension cannot read it on a locked phone.
 *
 * Expected behaviour: every keychain write the sign-in paths make carries both
 * options, and the key held offline is written the same way as the credential
 * it becomes.
 */

import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/shared/app/AuthStore';
import { savePendingApiKey } from '@/features/auth/lib/pendingSignIn';
import { KEYCHAIN_ACCESS_GROUP } from '@/shared/app/credentialKeychain';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(async () => true),
  unregisterPushToken: jest.fn(async () => true),
}));

const mockSetItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;

function expectEveryWriteSharedAndAfterFirstUnlock(expectedKeys: string[]) {
  const calls = mockSetItemAsync.mock.calls;
  expect(calls.map(([key]) => key).sort()).toEqual([...expectedKeys].sort());
  for (const [key, , options] of calls) {
    expect({ key, options }).toEqual({
      key,
      options: expect.objectContaining({
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        accessGroup: KEYCHAIN_ACCESS_GROUP,
      }),
    });
  }
}

describe('credential keychain writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes the API key, athlete id and key owner with the shared options', async () => {
    await useAuthStore.getState().setCredentials('key-1', 'i42');

    expectEveryWriteSharedAndAfterFirstUnlock([
      'intervals_api_key',
      'intervals_athlete_id',
      'intervals_api_key_athlete_id',
    ]);
  });

  it('writes the OAuth token and athlete id with the shared options', async () => {
    await useAuthStore.getState().setOAuthCredentials('token-1', 'i42');

    expectEveryWriteSharedAndAfterFirstUnlock(['intervals_access_token', 'intervals_athlete_id']);
  });

  it('writes the key held offline with the shared options', async () => {
    await savePendingApiKey(' key-1 ');

    expectEveryWriteSharedAndAfterFirstUnlock(['intervals_pending_api_key']);
  });
});
