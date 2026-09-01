/**
 * Account-change confirmation helper.
 *
 * The engine holds at most one account's data at a time. When a user signs
 * into a different account (or enters demo mode while real data is cached),
 * the cached data has to be wiped. We surface that as an explicit confirmation
 * so a deliberate "I'm switching accounts" gesture is required - never
 * silently destroy synced data.
 */

import { Alert } from 'react-native';
import { i18n } from '@/i18n';
import { getEngine, isEngineReady } from '@/shared/native/engine';
import { DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';
import { safeJsonParse } from '@/shared/validation/validation';
import { rememberCachedAthleteId, readCachedAthleteIdMirror } from '@/shared/storage';

export type AccountChangeKind = 'login' | 'demo';

/**
 * Returns the cached athlete id, or null if the device holds no account data.
 *
 * Three sources, in order of confidence. The engine is only initialised in
 * the authenticated branch, so at the login screen on a cold start it is
 * closed and every read answers its empty default for a device that is full
 * of another account's data. The gate is readiness, not the handle: the
 * handle is a singleton that exists from the first require and is never null
 * once the native module loads, so branching on it reads those defaults as
 * facts. `clearAuthOnly` drops the profile blob but keeps the activities,
 * which leaves the same gap with the engine up; the `__athlete_id` setting
 * covers that one, and the AsyncStorage mirror outlives the engine being down
 * and covers both the cold start and an engine that is up but has not been
 * told who it holds yet.
 */
export async function getCachedAthleteId(): Promise<string | null> {
  const engine = isEngineReady() ? getEngine() : null;
  if (engine) {
    const json = engine.getAthleteProfile();
    const parsed = json ? safeJsonParse<{ id?: number | string }>(json, {}) : null;
    const id = parsed?.id ? String(parsed.id) : engine.getSetting('__athlete_id');
    if (id) {
      await rememberCachedAthleteId(id);
      return id;
    }
  }
  return readCachedAthleteIdMirror();
}

/** What a sign-in or demo entry owes the data already on the device. */
export type AccountChangeAction = 'keep' | 'wipe' | 'confirm-then-wipe';

/**
 * The one rule three screens ask: the two login paths and `Try demo`.
 *
 * Demo fixtures are not an account. They are generated on demand and the demo
 * banner already discards them without asking, so a sign-in that has to clear
 * them asks nothing either. Anything else on disk is a real library and the
 * user has to say so before it goes.
 */
export function accountChangeAction(
  cachedAthleteId: string | null,
  incomingAthleteId: string
): AccountChangeAction {
  if (!cachedAthleteId || cachedAthleteId === incomingAthleteId) return 'keep';
  if (cachedAthleteId === DEMO_ATHLETE_ID) return 'wipe';
  return 'confirm-then-wipe';
}

interface ConfirmAccountChangeArgs {
  /** Identifier of the account currently cached on this device. */
  cachedAthleteId: string;
  /** What we're switching to: another real account, or demo mode. */
  incomingKind: AccountChangeKind;
}

/**
 * Wraps `Alert.alert` in a Promise<boolean>. Resolves `true` if the user
 * accepts the destructive action (cached data will be wiped), `false` if
 * they back out.
 *
 * Use the result to gate a `clearAccountData(queryClient)` call. Do NOT
 * proceed with the login / demo entry on `false` - keep the caller on the
 * current screen.
 */
export function confirmAccountChange(args: ConfirmAccountChangeArgs): Promise<boolean> {
  const { cachedAthleteId, incomingKind } = args;
  const t = i18n.t.bind(i18n);

  const title = t('alerts.accountChangeTitle', {
    defaultValue: 'Different account detected',
  });
  const body =
    incomingKind === 'demo'
      ? t('alerts.accountChangeDemoMessage', {
          cachedAthleteId,
          defaultValue:
            'This device has cached data for another account ({{cachedAthleteId}}). Continuing to demo mode will permanently delete that data. To keep it, go back and sign in to that account first.',
        })
      : t('alerts.accountChangeMessage', {
          cachedAthleteId,
          defaultValue:
            'This device has cached data for another account ({{cachedAthleteId}}). Signing in as a different account will permanently delete it. To keep it, go back and sign in to that account instead.',
        });
  const continueLabel = t('alerts.accountChangeContinue', {
    defaultValue: 'Continue and delete',
  });
  const cancelLabel = t('common.cancel');

  return new Promise((resolve) => {
    Alert.alert(title, body, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: continueLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
