import * as SecureStore from 'expo-secure-store';

import { readCredentialKeys } from './credentialRead';

/**
 * The keychain access group the app and its extensions share.
 *
 * It is the App Group id, which `src/plugins/with-keychain-access-group.js`
 * writes into the entitlement: an App Group identifier is accepted as an
 * access group without the team prefix, so no team id is pinned here.
 */
export const KEYCHAIN_ACCESS_GROUP = 'group.com.veloq.app';

/**
 * How every credential is written from now on.
 *
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` is a real weakening against
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: the token stays readable from the first
 * unlock after boot until power off, rather than only while the screen is
 * unlocked. It is the trade for letting a notification extension read it,
 * since a push mostly arrives at a locked phone and `WHEN_UNLOCKED` fails an
 * extension read outright.
 */
export const CREDENTIAL_KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  accessGroup: KEYCHAIN_ACCESS_GROUP,
};

/** How every release up to and including 0.4.0 wrote them. */
export const LEGACY_CREDENTIAL_KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** The keychain, as the migration needs it, so it can be tested without one. */
export interface CredentialKeychainIo {
  read: (key: string, options: SecureStore.SecureStoreOptions) => Promise<string | null>;
  write: (key: string, value: string, options: SecureStore.SecureStoreOptions) => Promise<void>;
  remove: (key: string, options: SecureStore.SecureStoreOptions) => Promise<void>;
}

export interface MigratingCredentialRead {
  /** One entry per key asked for, in order. A key that would not read is null. */
  values: (string | null)[];
  /** Keys that would not read, or would not move. A key that is absent is not here. */
  failedKeys: string[];
  /** Keys this launch moved out of the old attributes. */
  migratedKeys: string[];
}

/**
 * Read under the new attributes, and for anything not there yet, read under
 * the old ones and write it across.
 *
 * The upgrade path is the whole point: an install signed in before the access
 * group existed holds its items in the app's own group, and reading only the
 * shared group would sign every one of those athletes out. A key that throws
 * is not an absent key, so nothing is deleted on that path and the caller is
 * told which ones the keychain would not answer for.
 */
export async function readCredentialsWithMigration(
  io: CredentialKeychainIo,
  keys: readonly string[]
): Promise<MigratingCredentialRead> {
  const { values, failedKeys } = await readCredentialKeys(
    (key) => io.read(key, CREDENTIAL_KEYCHAIN_OPTIONS),
    keys
  );
  const migratedKeys: string[] = [];

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (values[i] !== null || failedKeys.includes(key)) continue;

    let legacy: string | null;
    try {
      legacy = await io.read(key, LEGACY_CREDENTIAL_KEYCHAIN_OPTIONS);
    } catch {
      failedKeys.push(key);
      continue;
    }
    if (legacy === null) continue;

    try {
      await io.write(key, legacy, CREDENTIAL_KEYCHAIN_OPTIONS);
    } catch {
      failedKeys.push(key);
      continue;
    }
    values[i] = legacy;
    migratedKeys.push(key);

    try {
      await io.remove(key, LEGACY_CREDENTIAL_KEYCHAIN_OPTIONS);
    } catch {
      // A copy left under the old attributes is read first next launch and
      // moved again. Reporting the credential is what matters here.
    }
  }

  return { values, failedKeys, migratedKeys };
}

/**
 * Delete a credential from both the shared group and the old attributes.
 *
 * A sign-out that cleared only the new copy would leave the old one for the
 * next launch to read and migrate, which signs the athlete straight back in.
 */
export async function deleteCredential(io: CredentialKeychainIo, key: string): Promise<void> {
  await Promise.all([
    io.remove(key, CREDENTIAL_KEYCHAIN_OPTIONS),
    io.remove(key, LEGACY_CREDENTIAL_KEYCHAIN_OPTIONS),
  ]);
}

/** The keychain itself, for everything but a test. */
export const secureStoreIo: CredentialKeychainIo = {
  read: (key, options) => SecureStore.getItemAsync(key, options),
  write: (key, value, options) => SecureStore.setItemAsync(key, value, options),
  remove: (key, options) => SecureStore.deleteItemAsync(key, options),
};
