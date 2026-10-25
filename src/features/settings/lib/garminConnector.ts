/**
 * The Garmin Personal key the athlete pastes.
 *
 * The key is a credential: it is kept in the keychain under the shared
 * credential options, held by the engine in memory, and written to no store,
 * setting or backup. The engine is the only caller of Garmin.
 */

import { GarminKeyStatus } from 'veloqrs';

import {
  CREDENTIAL_KEYCHAIN_OPTIONS,
  GARMIN_KEY_STORAGE_KEY,
  deleteCredential,
  readCredentialsWithMigration,
  secureStoreIo,
  type CredentialKeychainIo,
} from '@/shared/app/credentialKeychain';
import * as engineKey from '@/shared/native/garminKey';
import { getSetting, removeSetting, setSetting } from '@/shared/storage';

export { GARMIN_KEY_STORAGE_KEY };

/** Where a Personal key is made, on Garmin Connect Web. */
export const GARMIN_KEY_PAGE = 'https://connect.garmin.com/app/settings/personalApiToken';

/** The choices that belong to this device with its key. The record backup leaves them out. */
export const GARMIN_SETTING_KEYS = {
  keyExpiry: 'veloq-garmin-key-expiry',
  feed: 'veloq-garmin-feed',
  upload: 'veloq-garmin-upload',
} as const;

/** The choices kept on this device beside the key. */
export interface GarminChoices {
  keyExpiry: string;
  feed: boolean;
  upload: boolean;
}

export async function readGarminChoices(): Promise<GarminChoices> {
  const [keyExpiry, feed, upload] = await Promise.all([
    getSetting(GARMIN_SETTING_KEYS.keyExpiry),
    getSetting(GARMIN_SETTING_KEYS.feed),
    getSetting(GARMIN_SETTING_KEYS.upload),
  ]);
  return { keyExpiry: keyExpiry ?? '', feed: feed !== 'false', upload: upload === 'true' };
}

export const saveGarminKeyExpiry = (date: string): Promise<void> =>
  setSetting(GARMIN_SETTING_KEYS.keyExpiry, date);

export const saveGarminFeed = (on: boolean): Promise<void> =>
  setSetting(GARMIN_SETTING_KEYS.feed, String(on));

export const saveGarminUpload = (on: boolean): Promise<void> =>
  setSetting(GARMIN_SETTING_KEYS.upload, String(on));

/** The part of the engine the connector calls. */
export type GarminEngine = typeof engineKey;

interface Deps {
  io?: CredentialKeychainIo;
  engine?: GarminEngine;
}

/**
 * Ask Garmin whether the pasted key works, and keep it only when it does.
 * A key Garmin refuses, or that could not be checked, is never written.
 */
export async function connectGarminKey(pasted: string, deps: Deps = {}): Promise<GarminKeyStatus> {
  const key = pasted.trim();
  if (key === '') return GarminKeyStatus.Malformed;
  const status = await (deps.engine ?? engineKey).connectGarmin(key);
  if (status === GarminKeyStatus.Connected) {
    await (deps.io ?? secureStoreIo).write(
      GARMIN_KEY_STORAGE_KEY,
      key,
      CREDENTIAL_KEYCHAIN_OPTIONS
    );
  }
  return status;
}

/**
 * Forget the key everywhere it is held. Nothing already fetched is removed.
 * Each place is cleared even when another fails, and the first failure is
 * thrown after, so a locked keychain cannot leave the engine holding the key.
 */
export async function disconnectGarmin(
  deps: Deps & { removeSetting?: (key: string) => void | Promise<void> } = {}
): Promise<void> {
  const forget = deps.removeSetting ?? removeSetting;
  const results = await Promise.allSettled([
    deleteCredential(deps.io ?? secureStoreIo, GARMIN_KEY_STORAGE_KEY),
    Promise.resolve().then(() => (deps.engine ?? engineKey).clearGarminKey()),
    ...Object.values(GARMIN_SETTING_KEYS).map((key) => Promise.resolve().then(() => forget(key))),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

/** Give the engine the kept key at launch. Garmin is not asked until a pass needs a token. */
export async function restoreGarminKey(deps: Deps = {}): Promise<void> {
  const { values } = await readCredentialsWithMigration(deps.io ?? secureStoreIo, [
    GARMIN_KEY_STORAGE_KEY,
  ]);
  const key = values[0];
  if (key) (deps.engine ?? engineKey).holdGarminKey(key);
}

/**
 * Whether to warn that uploads from Veloq would duplicate what intervals.icu
 * imports from Garmin itself. With uploads off the import is the recommended
 * setup and nothing is warned. An unknown switch warns of nothing.
 */
export function garminDuplicateWarning(input: {
  syncsActivities: boolean | null | undefined;
  uploadOn: boolean;
}): boolean {
  return input.uploadOn && input.syncsActivities === true;
}
