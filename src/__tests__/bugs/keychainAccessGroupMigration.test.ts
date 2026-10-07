/**
 * Scenario: the credential moves into the shared keychain access group, so a
 * notification service extension can read it, and to accessibility after first
 * unlock, so it can be read while the phone is locked. Every existing install
 * holds an item written under the old attributes.
 *
 * Expected behaviour: the upgrade reads under the old attributes and writes
 * under the new ones, once, and signs nobody out. A keychain that will not
 * answer is not taken as an absent credential and nothing is deleted on that
 * path.
 */

import {
  CREDENTIAL_KEYCHAIN_OPTIONS,
  deleteCredential,
  LEGACY_CREDENTIAL_KEYCHAIN_OPTIONS,
  KEYCHAIN_ACCESS_GROUP,
  readCredentialsWithMigration,
} from '@/shared/app/credentialKeychain';

const KEYS = ['intervals_api_key', 'intervals_athlete_id'] as const;

const APP_ID_GROUP = 'ABCDE12345.com.example.app';

/**
 * A keychain by iOS's rules: an item has one access group, a write with no
 * group lands in the app id group, and a read or delete with no group matches
 * every group the app holds.
 */
function fakeKeychain(initial: {
  legacy?: Record<string, string>;
  shared?: Record<string, string>;
}) {
  const items = new Map<string, string>();
  const slot = (group: string, key: string) => `${group}\u0000${key}`;
  for (const [key, value] of Object.entries(initial.legacy ?? {})) {
    items.set(slot(APP_ID_GROUP, key), value);
  }
  for (const [key, value] of Object.entries(initial.shared ?? {})) {
    items.set(slot(KEYCHAIN_ACCESS_GROUP, key), value);
  }
  const groupsFor = (options: { accessGroup?: string }) =>
    options.accessGroup ? [options.accessGroup] : [APP_ID_GROUP, KEYCHAIN_ACCESS_GROUP];
  const inGroup = (group: string) => {
    const out: Record<string, string> = {};
    for (const [id, value] of items) {
      const [g, key] = id.split('\u0000');
      if (g === group) out[key] = value;
    }
    return out;
  };

  return {
    get legacy() {
      return inGroup(APP_ID_GROUP);
    },
    get shared() {
      return inGroup(KEYCHAIN_ACCESS_GROUP);
    },
    io: {
      read: jest.fn(async (key: string, options: { accessGroup?: string }) => {
        for (const group of groupsFor(options)) {
          const value = items.get(slot(group, key));
          if (value !== undefined) return value;
        }
        return null;
      }),
      write: jest.fn(async (key: string, value: string, options: { accessGroup?: string }) => {
        items.set(slot(options.accessGroup ?? APP_ID_GROUP, key), value);
      }),
      remove: jest.fn(async (key: string, options: { accessGroup?: string }) => {
        for (const group of groupsFor(options)) items.delete(slot(group, key));
      }),
    },
  };
}

describe('the credential keychain attributes', () => {
  it('writes into the shared group and after first unlock', () => {
    expect(CREDENTIAL_KEYCHAIN_OPTIONS.accessGroup).toBe(KEYCHAIN_ACCESS_GROUP);
    expect(CREDENTIAL_KEYCHAIN_OPTIONS.keychainAccessible).not.toBe(
      LEGACY_CREDENTIAL_KEYCHAIN_OPTIONS.keychainAccessible
    );
    expect(LEGACY_CREDENTIAL_KEYCHAIN_OPTIONS.accessGroup).toBeUndefined();
  });
});

describe('reading credentials across the access group change', () => {
  it('moves an existing install’s items without signing it out', async () => {
    const keychain = fakeKeychain({
      legacy: { intervals_api_key: 'key', intervals_athlete_id: '42' },
    });

    const result = await readCredentialsWithMigration(keychain.io, KEYS);

    expect(result.values).toEqual(['key', '42']);
    expect(result.migratedKeys).toEqual([...KEYS]);
    expect(keychain.shared).toEqual({ intervals_api_key: 'key', intervals_athlete_id: '42' });
    expect(keychain.io.remove).not.toHaveBeenCalled();
  });

  it('still reads the credentials on the second launch after the move', async () => {
    const keychain = fakeKeychain({
      legacy: { intervals_api_key: 'key', intervals_athlete_id: '42' },
    });

    await readCredentialsWithMigration(keychain.io, KEYS);
    const second = await readCredentialsWithMigration(keychain.io, KEYS);

    expect(second.values).toEqual(['key', '42']);
    expect(second.migratedKeys).toEqual([]);
    expect(second.failedKeys).toEqual([]);
  });

  it('reads the shared group on every later launch and rewrites nothing', async () => {
    const keychain = fakeKeychain({
      shared: { intervals_api_key: 'key', intervals_athlete_id: '42' },
    });

    const result = await readCredentialsWithMigration(keychain.io, KEYS);

    expect(result.values).toEqual(['key', '42']);
    expect(result.migratedKeys).toEqual([]);
    expect(keychain.io.write).not.toHaveBeenCalled();
    expect(keychain.io.remove).not.toHaveBeenCalled();
  });

  it('migrates only the key that is still under the old attributes', async () => {
    const keychain = fakeKeychain({
      legacy: { intervals_athlete_id: '42' },
      shared: { intervals_api_key: 'key' },
    });

    const result = await readCredentialsWithMigration(keychain.io, KEYS);

    expect(result.values).toEqual(['key', '42']);
    expect(result.migratedKeys).toEqual(['intervals_athlete_id']);
  });

  it('reports a fresh install as signed out and touches nothing', async () => {
    const keychain = fakeKeychain({});

    const result = await readCredentialsWithMigration(keychain.io, KEYS);

    expect(result.values).toEqual([null, null]);
    expect(result.migratedKeys).toEqual([]);
    expect(result.failedKeys).toEqual([]);
    expect(keychain.io.write).not.toHaveBeenCalled();
  });

  it('keeps the old item when the write under the new attributes fails', async () => {
    const keychain = fakeKeychain({ legacy: { intervals_api_key: 'key' } });
    keychain.io.write.mockRejectedValueOnce(new Error('keychain busy'));

    const result = await readCredentialsWithMigration(keychain.io, ['intervals_api_key']);

    expect(result.failedKeys).toEqual(['intervals_api_key']);
    expect(keychain.legacy).toEqual({ intervals_api_key: 'key' });
    expect(keychain.io.remove).not.toHaveBeenCalled();
  });

  it('does not fall back to the old attributes when the shared read throws', async () => {
    const keychain = fakeKeychain({ legacy: { intervals_api_key: 'key' } });
    keychain.io.read.mockRejectedValue(new Error('keychain locked'));

    const result = await readCredentialsWithMigration(keychain.io, ['intervals_api_key']);

    expect(result.values).toEqual([null]);
    expect(result.failedKeys).toEqual(['intervals_api_key']);
    expect(keychain.io.write).not.toHaveBeenCalled();
    expect(keychain.io.remove).not.toHaveBeenCalled();
  });
});

describe('signing out across the access group change', () => {
  it('clears both copies, so the next launch does not migrate the athlete back in', async () => {
    const keychain = fakeKeychain({
      legacy: { intervals_api_key: 'key' },
      shared: { intervals_api_key: 'key' },
    });

    await deleteCredential(keychain.io, 'intervals_api_key');
    const result = await readCredentialsWithMigration(keychain.io, ['intervals_api_key']);

    expect(keychain.legacy).toEqual({});
    expect(keychain.shared).toEqual({});
    expect(result.values).toEqual([null]);
  });

  it('reads null for both keys after a migrated athlete signs out', async () => {
    const keychain = fakeKeychain({
      legacy: { intervals_api_key: 'key', intervals_athlete_id: '42' },
    });

    await readCredentialsWithMigration(keychain.io, KEYS);
    for (const key of KEYS) await deleteCredential(keychain.io, key);
    const result = await readCredentialsWithMigration(keychain.io, KEYS);

    expect(result.values).toEqual([null, null]);
  });
});
