/**
 * Scenario: launch reads three keychain entries to decide whether there is a
 * session. `Promise.all` rejects whole, so one transient SecureStore failure
 * discarded the other two reads and signed the athlete out for the session,
 * silently, with a device full of their data.
 *
 * Expected behaviour: each key answers for itself, a rejection is not a null,
 * and a rejected key is asked once more before it is taken as an answer.
 */
import { readCredentialKeys } from '@/shared/app/credentialRead';

const KEYS = ['api-key', 'athlete-id', 'access-token'] as const;

/** A keychain that answers per key, and can be told to throw a set number of times. */
function keychain(entries: Record<string, string | null>, throwsFor: Record<string, number> = {}) {
  const attempts: string[] = [];
  const remaining = { ...throwsFor };
  return {
    attempts,
    read: async (key: string) => {
      attempts.push(key);
      if ((remaining[key] ?? 0) > 0) {
        remaining[key] -= 1;
        throw new Error(`keychain refused ${key}`);
      }
      return entries[key] ?? null;
    },
  };
}

it('keeps the other two reads when one key rejects', async () => {
  const store = keychain(
    { 'api-key': 'k', 'athlete-id': 'i350768', 'access-token': null },
    { 'access-token': 99 }
  );

  const { values, failedKeys } = await readCredentialKeys(store.read, KEYS);

  expect(values).toEqual(['k', 'i350768', null]);
  expect(failedKeys).toEqual(['access-token']);
});

it('retries a rejected key exactly once, and takes the value the retry gives', async () => {
  const store = keychain(
    { 'api-key': 'k', 'athlete-id': 'i350768', 'access-token': 'tok' },
    {
      'access-token': 1,
    }
  );

  const { values, failedKeys } = await readCredentialKeys(store.read, KEYS);

  expect(values[2]).toBe('tok');
  expect(failedKeys).toEqual([]);
  expect(store.attempts.filter((k) => k === 'access-token')).toHaveLength(2);
});

it('asks a key that read cleanly only once', async () => {
  const store = keychain({ 'api-key': 'k', 'athlete-id': 'i350768', 'access-token': null });

  await readCredentialKeys(store.read, KEYS);

  expect(store.attempts).toEqual(['api-key', 'athlete-id', 'access-token']);
});

it('tells a null read apart from a rejected one', async () => {
  const store = keychain(
    { 'api-key': null, 'athlete-id': 'i350768', 'access-token': null },
    {
      'access-token': 99,
    }
  );

  const { values, failedKeys } = await readCredentialKeys(store.read, KEYS);

  expect(values[0]).toBeNull();
  expect(values[2]).toBeNull();
  expect(failedKeys).toEqual(['access-token']);
});

it('gives every key back as null when the whole keychain is refusing', async () => {
  const store = keychain({}, { 'api-key': 99, 'athlete-id': 99, 'access-token': 99 });

  const { values, failedKeys } = await readCredentialKeys(store.read, KEYS);

  expect(values).toEqual([null, null, null]);
  expect(failedKeys).toEqual([...KEYS]);
  expect(store.attempts).toHaveLength(6);
});

it('reads nothing when asked for no keys', async () => {
  const store = keychain({});
  await expect(readCredentialKeys(store.read, [])).resolves.toEqual({
    values: [],
    failedKeys: [],
  });
});

describe('AuthStore.initialize', () => {
  beforeEach(() => jest.resetModules());

  async function initializeWith(refused: string) {
    jest.doMock('expo-secure-store', () => ({
      getItemAsync: jest.fn(async (key: string) => {
        if (key === refused) throw new Error('keychain refused');
        if (key === 'intervals_api_key') return 'k';
        if (key === 'intervals_athlete_id') return 'i350768';
        return null;
      }),
      setItemAsync: jest.fn(),
      deleteItemAsync: jest.fn(),
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlocked',
    }));
    jest.doMock('@/shared/native/engine', () => ({ getEngine: () => null }));
    jest.doMock('@/shared/app/seedDemoEngine', () => ({ seedDemoEngine: () => {} }));
    const { useAuthStore } = require('@/shared/app/AuthStore');
    await useAuthStore.getState().initialize();
    return useAuthStore.getState();
  }

  it('keeps the API-key session when the unused OAuth key will not read', async () => {
    const state = await initializeWith('intervals_access_token');

    expect(state.isAuthenticated).toBe(true);
    expect(state.authMethod).toBe('apiKey');
    expect(state.isLoading).toBe(false);
  });

  it('still leaves no session when the athlete id itself will not read', async () => {
    const state = await initializeWith('intervals_athlete_id');

    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });
});
