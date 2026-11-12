/**
 * Signing in with a Garmin Personal key and nothing else.
 *
 * The login screen has no engine, so Garmin is asked about the key on its own
 * and the library already on the device is judged against the identity
 * `garmin:<id>` by the rule an intervals.icu sign-in follows. Nothing is
 * stored until Garmin has accepted the key and named the account.
 */

import { checkGarminKey, GarminKeyStatus } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { garminAthleteId } from '@/shared/app/storedSession';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';
import type { QueryClient } from '@tanstack/react-query';

import { resolveLoginLibrary, type LoginLibraryOutcome } from './loginLibrary';

export type GarminSignInOutcome =
  | { kind: 'signedIn' }
  /** The athlete backed out of the question about the library on the device. */
  | { kind: 'refused' }
  /** Garmin did not accept the key, or could not be asked. */
  | { kind: 'failed'; status: GarminKeyStatus }
  /** Garmin accepted the key and named no account to call the library after. */
  | { kind: 'noAccount' };

export interface GarminSignInSteps {
  check: (key: string) => Promise<{ status: GarminKeyStatus; accountId?: string | undefined }>;
  resolveLibrary: (athleteId: string) => Promise<LoginLibraryOutcome>;
  /** Clear only the auth, so the library stays for its own account. */
  keepLibrary: () => Promise<void>;
  /** Empty the library of the account being replaced. */
  wipeLibrary: () => Promise<void>;
  signIn: (key: string, accountId: string) => Promise<void>;
}

/** The steps the login screen runs, over the query cache it clears with. */
export function liveGarminSignInSteps(queryClient: QueryClient): GarminSignInSteps {
  return {
    check: (key) => checkGarminKey(key),
    resolveLibrary: resolveLoginLibrary,
    keepLibrary: () => clearAuthOnly(queryClient),
    wipeLibrary: () => clearAccountData(queryClient),
    signIn: (key, accountId) => useAuthStore.getState().setGarminCredentials(key, accountId),
  };
}

export async function signInWithGarminKey(
  pasted: string,
  steps: GarminSignInSteps
): Promise<GarminSignInOutcome> {
  const key = pasted.trim();
  if (key === '') return { kind: 'failed', status: GarminKeyStatus.Malformed };

  let checked: Awaited<ReturnType<GarminSignInSteps['check']>>;
  try {
    checked = await steps.check(key);
  } catch {
    return { kind: 'failed', status: GarminKeyStatus.Unreachable };
  }
  if (checked.status !== GarminKeyStatus.Connected) {
    return { kind: 'failed', status: checked.status };
  }
  if (!checked.accountId?.trim()) return { kind: 'noAccount' };

  const outcome = await steps.resolveLibrary(garminAthleteId(checked.accountId));
  if (outcome === 'refused') return { kind: 'refused' };
  if (outcome === 'keep') await steps.keepLibrary();
  else await steps.wipeLibrary();
  await steps.signIn(key, checked.accountId.trim());
  return { kind: 'signedIn' };
}
