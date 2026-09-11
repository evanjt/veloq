/**
 * How much library a destructive path is about to destroy.
 *
 * The engine is closed on the login screen by design, and a closed handle
 * answers `getActivityCount()` with 0, which is the same answer an empty
 * device gives. A backup restored from that screen therefore read as nothing
 * to lose: Try Demo seeded the demo fixtures straight into it without asking,
 * and the sign-in after that wiped it without asking either.
 *
 * So the count comes from the library, not the handle. An open engine is
 * authoritative and answers it directly; a closed one is answered from the
 * mirror the restore left behind.
 */

import { getEngine, isEngineReady } from '@/shared/native/engine';
import { readStoredActivityCountMirror } from '@/shared/storage';
import { DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';
import { accountChangeAction, getCachedAthleteId, type AccountChangeAction } from './accountChange';

export async function resolveStoredActivityCount(): Promise<number> {
  if (isEngineReady()) return getEngine()?.getActivityCount() ?? 0;
  return readStoredActivityCountMirror();
}

/**
 * What Try Demo owes whatever is already on the device.
 *
 * The two reads belong together: the identity a restore does not stamp, and
 * the count a closed engine cannot give. Keeping them in one function is what
 * lets the decision be tested without the screen.
 */
export async function demoEntryAction(): Promise<AccountChangeAction> {
  const cachedId = await getCachedAthleteId();
  return accountChangeAction(cachedId, DEMO_ATHLETE_ID, await resolveStoredActivityCount());
}
