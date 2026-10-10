/**
 * The Google account the Drive carrier writes to, by its email address.
 *
 * Held in SecureStore beside the WebDAV config rather than in the engine's
 * settings, because the login screen signs in to Google to restore before any
 * library is open, and that sign-in is what sets the carrier up. No token is
 * held here: Play services keeps the grant. Separated from the backend so the
 * orchestration can read it without importing the carrier.
 */

import * as SecureStore from 'expo-secure-store';

const ACCOUNT_KEY = 'veloq-google-drive-account';

let cached: string | null = null;
let loaded = false;
/** Moves on every hold and forget, so a load that started earlier cannot write back. */
let generation = 0;

/** The held account, or null. Synchronous from the cache `loadGoogleDriveAccount` fills. */
export function getGoogleDriveAccount(): string | null {
  return cached;
}

/** Read the held account into the cache, once per process. */
export async function loadGoogleDriveAccount(): Promise<string | null> {
  if (loaded) return cached;
  const started = generation;
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(ACCOUNT_KEY);
  } catch {
    stored = null;
  }
  if (started === generation) {
    cached = stored || null;
    loaded = true;
  }
  return cached;
}

/** Hold the account a sign-in chose. */
export async function holdGoogleDriveAccount(email: string): Promise<void> {
  generation += 1;
  cached = email;
  loaded = true;
  await SecureStore.setItemAsync(ACCOUNT_KEY, email, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** Forget the account. The cache clears at once, so no run starts against it. */
export async function clearGoogleDriveAccount(): Promise<void> {
  generation += 1;
  cached = null;
  loaded = true;
  await SecureStore.deleteItemAsync(ACCOUNT_KEY);
}
