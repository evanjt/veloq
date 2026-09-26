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

/** A keychain holding one entry per (key, access group). */
function fakeKeychain(initial: {
  legacy?: Record<string, string>;
  shared?: Record<string, string>;
}) {
  const legacy = { ...(initial.legacy ?? {}) };
  const shared = { ...(initial.shared ?? {}) };
  const bucket = (options: { accessGroup?: string }) =>
    options.accessGroup === KEYCHAIN_ACCESS_GROUP ? shared : legacy;

  return {
    legacy,
    shared,
    io: {
      read: jest.fn(
        async (key: string, options: { accessGroup?: string }) => bucket(options)[key] ?? null
      ),
      write: jest.fn(async (key: string, value: string, options: { accessGroup?: string }) => {
        bucket(options)[key] = value;
      }),
      remove: jest.fn(async (key: string, options: { accessGroup?: string }) => {
        delete bucket(options)[key];
      }),
    },
  };
}

describe('the credential keychain attributes', () => {
  it('names the same group the entitlement plugin writes', () => {
    const plugin = require('@/plugins/with-keychain-access-group');
    expect(KEYCHAIN_ACCESS_GROUP).toBe(plugin.KEYCHAIN_ACCESS_GROUP);
  });

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
    expect(keychain.legacy).toEqual({});
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

  it('answers with the value when the old item will not delete', async () => {
    const keychain = fakeKeychain({ legacy: { intervals_api_key: 'key' } });
    keychain.io.remove.mockRejectedValueOnce(new Error('keychain busy'));

    const result = await readCredentialsWithMigration(keychain.io, ['intervals_api_key']);

    expect(result.values).toEqual(['key']);
    expect(result.failedKeys).toEqual([]);
    expect(keychain.shared).toEqual({ intervals_api_key: 'key' });
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
});
