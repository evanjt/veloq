import type { TFunction } from 'i18next';
import { InitOutcome } from 'veloqrs';

import { navigateTo } from '@/shared/app/navigation';
import { offerCrashLog, openForum, openStorePage } from '@/shared/app/supportLinks';

/**
 * The line each reason the engine gave for not opening names.
 *
 * The reason is the engine's, never re-derived here. A database written by a
 * newer build is fixed by updating the app, a file another connection holds
 * fixes itself on the retry, a directory nothing can be written to needs
 * space or permission, and a file whose version records disagree with its
 * tables is kept on the device for someone to look at.
 *
 * `Opened` and `NotAttempted` are not failures, and a variant this bundle has
 * no case for is what an engine newer than it produces. Both fall through to
 * the general line rather than rendering a key as text.
 */
export function engineInitReasonKey(reason: InitOutcome | null) {
  switch (reason) {
    case InitOutcome.Busy:
      return 'engine.initReason.busy';
    case InitOutcome.ForwardSchema:
      return 'engine.initReason.forwardSchema';
    case InitOutcome.StorageUnavailable:
      return 'engine.initReason.storageUnavailable';
    case InitOutcome.Failed:
      return 'engine.initReason.failed';
    case InitOutcome.VersionMismatch:
      return 'engine.initReason.versionMismatch';
    default:
      return 'engine.initFailed';
  }
}

export interface EngineRecoveryAction {
  label: string;
  onPress: () => void;
  testID: string;
}

/**
 * The actions each reason offers, the one most likely to fix it first, and a
 * retry only where opening again can succeed: a newer build's database and a
 * file kept aside open the same way on every attempt. A reason this bundle has
 * no case for keeps the retry, since nothing is known that rules it out.
 */
export function engineRecoveryActions(
  reason: InitOutcome | null,
  t: TFunction,
  retry: () => void
): EngineRecoveryAction[] {
  const retryAction = { label: t('common.retry'), onPress: retry, testID: 'engine-retry-button' };
  switch (reason) {
    case InitOutcome.ForwardSchema:
      return [
        {
          label: t('engine.initAction.update'),
          onPress: () => openStorePage(),
          testID: 'engine-update-button',
        },
      ];
    case InitOutcome.StorageUnavailable:
      return [
        {
          label: t('engine.initAction.freeSpace'),
          onPress: () => navigateTo('/cache-settings'),
          testID: 'engine-free-space-button',
        },
        retryAction,
      ];
    case InitOutcome.VersionMismatch:
      return [
        {
          label: t('support.shareCrashLog'),
          onPress: () => {
            void offerCrashLog(t);
          },
          testID: 'engine-share-crash-log-button',
        },
        { label: t('support.forum'), onPress: openForum, testID: 'engine-forum-button' },
      ];
    default:
      return [retryAction];
  }
}
