/**
 * What launch owes the library already on disk, and in what order.
 *
 * The engine holds one athlete's library at a time. Launch opens it, finds out
 * whose it is, and only then may start anything that writes: the launch sync,
 * the elevation backfill and the detector cutover all carry the signed-in
 * athlete's credentials. When the library belongs to someone else that
 * question goes to the athlete, and nothing may run until it is answered.
 */

/** The three shapes launch can find, once the engine is open. */
export type LaunchIdentityAction = 'proceed' | 'wipe-then-proceed' | 'ask-first';

/**
 * Whose library is on disk against who signed in.
 *
 * An empty engine has nothing to lose and takes the new identity as it stands.
 * A library with activities in it is the athlete's only copy, so it is never
 * wiped without being asked.
 */
export function launchIdentityAction(
  cachedAthleteId: string | null | undefined,
  credentialsAthleteId: string | null | undefined,
  storedActivityCount: number
): LaunchIdentityAction {
  if (!cachedAthleteId || !credentialsAthleteId) return 'proceed';
  if (cachedAthleteId === credentialsAthleteId) return 'proceed';
  return storedActivityCount > 0 ? 'ask-first' : 'wipe-then-proceed';
}

interface LaunchIdentitySteps {
  /** Empty the library and re-open it. Resolves once the wipe has finished. */
  wipe: () => Promise<void>;
  /** Re-open the database. Returns whether it opened. */
  reopen: () => boolean;
  /** Put the question to the athlete. Resolves whether the library was cleared. */
  ask: () => Promise<boolean>;
  /**
   * Everything launch does once the library's identity is settled: the sync,
   * the backfill, the cutover, and the stores seeded from the engine.
   */
  proceed: () => void;
}

/**
 * Run the steps in the order the action calls for, and report whether launch
 * proceeded before returning.
 *
 * `ask-first` returns `false`: the question is on screen and `proceed` runs
 * from its answer, or not at all. Falling through to `proceed` here is what
 * wrote athlete B's activities into athlete A's tables while the prompt was
 * still up, and left Cancel with a library carrying both.
 */
export async function completeLaunchIdentity(
  action: LaunchIdentityAction,
  steps: LaunchIdentitySteps
): Promise<boolean> {
  if (action === 'proceed') {
    steps.proceed();
    return true;
  }
  if (action === 'wipe-then-proceed') {
    await steps.wipe();
    if (!steps.reopen()) return false;
    steps.proceed();
    return true;
  }
  void steps.ask().then((cleared) => {
    if (cleared && steps.reopen()) steps.proceed();
  });
  return false;
}
