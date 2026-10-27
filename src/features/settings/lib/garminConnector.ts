/**
 * The Garmin Personal key the athlete pastes.
 *
 * The key is a credential: it is kept in the keychain under the shared
 * credential options, held by the engine in memory, and written to no store,
 * setting or backup. The engine is the only caller of Garmin.
 */

import { GarminKeyStatus, GarminMatch, type GarminAccount } from 'veloqrs';

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

import { parseGarminOfferRecord } from './garminOffer';

export { GARMIN_KEY_STORAGE_KEY };

/** Where a Personal key is made, on Garmin Connect Web. */
export const GARMIN_KEY_PAGE = 'https://connect.garmin.com/app/settings/personalApiToken';

/** The post in the intervals.icu forum thread that says what Garmin's terms mean for the data it shares. */
export const GARMIN_FORUM_THREAD =
  'https://forum.intervals.icu/t/api-access-to-intervals-icu/609/75';

/** The choices that belong to this device with its key. The record backup leaves them out. */
export const GARMIN_SETTING_KEYS = {
  feed: 'veloq-garmin-feed',
  upload: 'veloq-garmin-upload',
  /** The moment the automatic swap was switched on, or `false`. The engine reads the same row. */
  autoSwap: 'veloq-garmin-auto-swap',
  /** Why the engine switched the automatic swap off. */
  autoSwapStopped: 'veloq-garmin-auto-swap-stopped',
  /** The rides the automatic swap has dealt with. The engine writes it. */
  autoSwapHandled: 'veloq-garmin-auto-swap-handled',
  offerDeclinedAt: 'veloq-garmin-offer-declined-at',
} as const;

/**
 * Whether a key was connected on this library: true while one is kept, false
 * after Disconnect. It holds no key, so a record backup carries it, and a
 * restore onto a device without the key reads "Key needed" rather than "off".
 * The engine names the same key as `settings_keys::GARMIN_CONNECTOR_ENABLED`.
 */
export const GARMIN_CONNECTOR_ENABLED_KEY = '__garmin_connector_enabled';

/** Where the connector stands: a key is kept, one was connected and is now missing, or none was. */
export type GarminConnectorState = 'connected' | 'keyNeeded' | 'off';

/** A kept key is connected whatever the flag says, and a flag with no key is a key the athlete must paste again. */
export function garminConnectorState(input: {
  enabled: boolean;
  keyKept: boolean;
}): GarminConnectorState {
  if (input.keyKept) return 'connected';
  return input.enabled ? 'keyNeeded' : 'off';
}

/** The choices kept on this device beside the key. */
export interface GarminChoices {
  feed: boolean;
  upload: boolean;
  autoSwap: boolean;
  /** Why the engine switched the automatic swap off, or an empty string. */
  autoSwapStopped: string;
}

export async function readGarminChoices(): Promise<GarminChoices> {
  const [feed, upload, autoSwap, autoSwapStopped] = await Promise.all([
    getSetting(GARMIN_SETTING_KEYS.feed),
    getSetting(GARMIN_SETTING_KEYS.upload),
    getSetting(GARMIN_SETTING_KEYS.autoSwap),
    getSetting(GARMIN_SETTING_KEYS.autoSwapStopped),
  ]);
  return {
    feed: feed !== 'false',
    upload: upload === 'true',
    autoSwap: autoSwap != null && !Number.isNaN(Date.parse(autoSwap)),
    autoSwapStopped: autoSwapStopped ?? '',
  };
}

export const saveGarminFeed = (on: boolean): Promise<void> =>
  setSetting(GARMIN_SETTING_KEYS.feed, String(on));

export const saveGarminUpload = (on: boolean): Promise<void> =>
  setSetting(GARMIN_SETTING_KEYS.upload, String(on));

/**
 * The switch is the moment it was turned on, which is how the engine knows to
 * leave every ride imported before it alone. Turning it on clears the reason
 * an earlier pass switched it off.
 */
export async function saveGarminAutoSwap(on: boolean): Promise<void> {
  if (on) {
    await removeSetting(GARMIN_SETTING_KEYS.autoSwapStopped);
    await setSetting(GARMIN_SETTING_KEYS.autoSwap, new Date().toISOString());
  } else {
    await setSetting(GARMIN_SETTING_KEYS.autoSwap, 'false');
  }
}

const saveEnabled = (on: boolean): Promise<void> =>
  setSetting(GARMIN_CONNECTOR_ENABLED_KEY, String(on));

const listeners = new Set<() => void>();

/** Tell every mounted reader that the connection changed in this process. */
function changed(): void {
  for (const listener of listeners) listener();
}

/** Called on each connect or disconnect, so a reader already on screen reads again. Returns the unsubscribe. */
export function onGarminConnectorChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The part of the engine the connector calls. */
export type GarminEngine = typeof engineKey;

interface Deps {
  io?: CredentialKeychainIo;
  engine?: GarminEngine;
  setEnabled?: (on: boolean) => void | Promise<void>;
  readEnabled?: () => Promise<string | null>;
}

/** The connector's state from the device: the flag beside the key the keychain holds. */
export async function readGarminConnectorState(deps: Deps = {}): Promise<GarminConnectorState> {
  const [enabled, { values }] = await Promise.all([
    (deps.readEnabled ?? (() => getSetting(GARMIN_CONNECTOR_ENABLED_KEY)))(),
    readCredentialsWithMigration(deps.io ?? secureStoreIo, [GARMIN_KEY_STORAGE_KEY]),
  ]);
  return garminConnectorState({ enabled: enabled === 'true', keyKept: Boolean(values[0]) });
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
    await (deps.setEnabled ?? saveEnabled)(true);
    changed();
  }
  return status;
}

/**
 * The account behind the key just connected. It is a reading, not a condition
 * of the connection: a failed read leaves the connection standing and reads as
 * no account.
 */
export async function readGarminAccount(deps: Deps = {}): Promise<GarminAccount | undefined> {
  try {
    return (await (deps.engine ?? engineKey).garminAccount()) ?? undefined;
  } catch {
    return undefined;
  }
}

/** What the account reading says: the name on the account, and the one line the rides allow. */
export type GarminAccountReading =
  | { kind: 'matched'; name: string | undefined; count: number }
  | { kind: 'wrongAccount'; name: string | undefined }
  | { kind: 'connected'; name: string | undefined };

export function garminAccountReading(account: GarminAccount): GarminAccountReading {
  const name = account.displayName ?? undefined;
  switch (account.matched) {
    case GarminMatch.Matched:
      return { kind: 'matched', name, count: account.matchedCount };
    case GarminMatch.WrongAccount:
      return { kind: 'wrongAccount', name };
    default:
      return { kind: 'connected', name };
  }
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
    Promise.resolve().then(() => (deps.setEnabled ?? saveEnabled)(false)),
    ...Object.values(GARMIN_SETTING_KEYS).map((key) => Promise.resolve().then(() => forget(key))),
  ]);
  changed();
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

/** Whether a Garmin key is kept on this device. */
export async function isGarminConnected(deps: Deps = {}): Promise<boolean> {
  const { values } = await readCredentialsWithMigration(deps.io ?? secureStoreIo, [
    GARMIN_KEY_STORAGE_KEY,
  ]);
  return Boolean(values[0]);
}

/** The held-back count the feed offer was last declined at, or null when never declined. */
export async function readGarminOfferDeclinedAt(): Promise<number | null> {
  return parseGarminOfferRecord(await getSetting(GARMIN_SETTING_KEYS.offerDeclinedAt));
}

export const saveGarminOfferDeclinedAt = (count: number): Promise<void> =>
  setSetting(GARMIN_SETTING_KEYS.offerDeclinedAt, String(count));

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
