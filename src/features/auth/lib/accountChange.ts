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
import { getRouteEngine } from '@/shared/native/routeEngine';
import { safeJsonParse } from '@/shared/validation/validation';

export type AccountChangeKind = 'login' | 'demo';

/**
 * Returns the cached athlete id from the engine's `athlete_profile` blob,
 * or null if nothing is cached.
 */
export function getCachedAthleteId(): string | null {
  const engine = getRouteEngine();
  if (!engine) return null;
  const json = engine.getAthleteProfile();
  if (!json) return null;
  const parsed = safeJsonParse<{ id?: number | string }>(json, {});
  if (!parsed?.id) return null;
  return String(parsed.id);
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
