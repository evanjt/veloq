import * as SecureStore from 'expo-secure-store';

import {
  CREDENTIAL_KEYCHAIN_OPTIONS,
  deleteCredential,
  secureStoreIo,
} from '@/shared/app/credentialKeychain';

/**
 * A key typed while the radio was down, waiting for the real check.
 *
 * It is not the credential the app syncs with: it sits under a key of its own
 * so nothing that reads a session can mistake it for one, and it is held in
 * the keychain rather than in plain storage because it is an API key whichever
 * side of the check it is on.
 */
const PENDING_API_KEY = 'intervals_pending_api_key';

/** What a sign-in attempt should do with what the athlete typed. */
export type SignInPlan = 'validate' | 'queue' | 'empty';

/**
 * Nothing is accepted on trust: a queued key is held, not signed in, and the
 * validation and the athlete-identity check run in full when the radio is
 * back. So the only thing the network state decides is when to ask, not
 * whether to.
 */
export function signInPlan(isOnline: boolean, apiKey: string): SignInPlan {
  if (!apiKey.trim()) return 'empty';
  return isOnline ? 'validate' : 'queue';
}

export async function savePendingApiKey(apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_API_KEY, apiKey.trim(), CREDENTIAL_KEYCHAIN_OPTIONS);
}

export async function readPendingApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PENDING_API_KEY, CREDENTIAL_KEYCHAIN_OPTIONS);
  } catch {
    return null;
  }
}

export async function clearPendingApiKey(): Promise<void> {
  try {
    await deleteCredential(secureStoreIo, PENDING_API_KEY);
  } catch {
    // Best effort: a key that will not delete is re-checked on the next edge
    // and dropped then.
  }
}
