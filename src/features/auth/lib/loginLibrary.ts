import { i18n } from '@/i18n';
import {
  accountChangeAction,
  confirmAccountChange,
  getCachedAthleteId,
  settleBeforeNamingLibrary,
} from './accountChange';
import { resolveStoredActivityCount } from './storedActivityCount';
import { wipeListText } from '@/shared/storage';
import { chooseAction } from '@/shared/ui/dialog';

/** What a sign-in does with the library already on the device. */
export type LoginLibraryOutcome = 'keep' | 'wipe' | 'refused';

type UnnamedLibraryChoice = 'mine' | 'delete' | 'cancel';

/**
 * Asks about a library that names no athlete. Adopting it is as destructive
 * to the other account as deleting it is to this one, so neither is a default.
 * The message counts the activities and lists what Delete it removes.
 */
function askAboutUnnamedLibrary(activityCount: number): Promise<UnnamedLibraryChoice> {
  const t = i18n.t.bind(i18n);
  return new Promise((resolve) => {
    // Required: login waits on this answer, and neither keeping nor deleting
    // is safe to assume, so back and the scrim do nothing.
    chooseAction({
      title: t('alerts.accountChangeTitle', { defaultValue: 'Different account detected' }),
      message: `${t('alerts.unnamedLibraryMessage', {
        count: activityCount,
        defaultValue_one:
          "This device has a library of {{count}} activity that isn't linked to an account. If it's yours, keep it and it'll sync to this account. Otherwise, delete it.",
        defaultValue_other:
          "This device has a library of {{count}} activities that isn't linked to an account. If it's yours, keep it and it'll sync to this account. Otherwise, delete it.",
      })}\n\n${wipeListText('deleted', t)}`,
      cancelLabel: t('common.cancel'),
      onCancel: () => resolve('cancel'),
      actions: [
        {
          label: t('alerts.unnamedLibraryDelete', { defaultValue: 'Delete it' }),
          destructive: true,
          onPress: () => resolve('delete'),
        },
        {
          label: t('alerts.unnamedLibraryMine', { defaultValue: 'This is mine' }),
          onPress: () => resolve('mine'),
        },
      ],
      required: true,
    });
  });
}

/**
 * The one answer both login paths act on: keep what is on the device and
 * clear only the auth, wipe it, or stop because the athlete backed out.
 * An unnamed library with activities is adopted only on the athlete's say-so.
 */
export async function resolveLoginLibrary(incomingId: string): Promise<LoginLibraryOutcome> {
  const cachedId = await getCachedAthleteId();
  const activityCount = await resolveStoredActivityCount();
  const action = accountChangeAction(cachedId, incomingId, activityCount);
  if (action === 'wipe') return 'wipe';
  if (action === 'confirm-then-wipe') {
    if (cachedId) {
      const proceed = await confirmAccountChange({
        cachedAthleteId: cachedId,
        incomingKind: 'login',
      });
      return proceed ? 'wipe' : 'refused';
    }
    const choice = await askAboutUnnamedLibrary(activityCount);
    if (choice === 'cancel') return 'refused';
    if (choice === 'delete') return 'wipe';
  }
  if (!cachedId) await settleBeforeNamingLibrary();
  return 'keep';
}
