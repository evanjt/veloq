/**
 * The library wipe a sign-in runs when the incoming account differs from the
 * one on the device, and the line to show when it fails.
 *
 * A sign-in screen's catch cannot tell a refused wipe from a failed network
 * call, so the wipe's failure is marked here and read back by `signInFailureKey`.
 */

import { clearAccountData } from '@/shared/storage';
import { engineErrorKey } from '@/shared/native/engineError';

/** The library could not be emptied; `cause` is what the wipe threw. */
class LibraryWipeFailed extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super('The library could not be cleared');
    this.name = 'LibraryWipeFailed';
    this.cause = cause;
  }
}

/** `clearAccountData`, with a failure marked as the wipe's own. */
export async function clearLibraryForSignIn(queryClient: { clear: () => void }): Promise<void> {
  try {
    await clearAccountData(queryClient);
  } catch (cause) {
    throw new LibraryWipeFailed(cause);
  }
}

/**
 * The line for a sign-in failure: the engine's own for a failed wipe, and
 * `fallback` for anything else.
 */
export function signInFailureKey<Fallback extends string>(error: unknown, fallback: Fallback) {
  if (error instanceof LibraryWipeFailed)
    return engineErrorKey(error.cause, 'alerts.failedToClear');
  return fallback;
}
