import type { TFunction } from 'i18next';
import { FfiInitOutcome, type FfiStorageShortfall } from 'veloqrs';

import type { EngineInitReason } from '@/features/routes/stores/EngineStatusStore';
import { formatFileSize } from '@/shared/format/format';
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
 * A launch wipe that rejected leaves the previous athlete's library open, so
 * its line says the wipe failed, not that the library is untouched.
 *
 * `Opened` and `NotAttempted` are not failures, and a variant this bundle has
 * no case for is what an engine newer than it produces. Both fall through to
 * the general line rather than rendering a key as text.
 */
export function engineInitReasonKey(reason: EngineInitReason | null) {
  switch (reason) {
    case FfiInitOutcome.Busy:
      return 'engine.initReason.busy';
    case FfiInitOutcome.ForwardSchema:
      return 'engine.initReason.forwardSchema';
    case FfiInitOutcome.StorageUnavailable:
      return 'engine.initReason.storageUnavailable';
    case FfiInitOutcome.Failed:
      return 'engine.initReason.failed';
    case FfiInitOutcome.VersionMismatch:
      return 'engine.initReason.versionMismatch';
    case 'wipeFailed':
      return 'engine.initReason.wipeFailed';
    default:
      return 'engine.initFailed';
  }
}

/**
 * The sentence for a reason. A full volume names the bytes the upgrade needs
 * when the engine recorded them, and only for that reason: a shortfall left
 * from an earlier attempt says nothing about a later one.
 */
export function engineInitReasonLine(
  reason: EngineInitReason | null,
  shortfall: FfiStorageShortfall | null,
  t: TFunction
): string {
  if (reason === FfiInitOutcome.StorageUnavailable && shortfall) {
    return t('engine.initReason.storageShortfall', {
      needed: formatFileSize(shortfall.neededBytes),
    });
  }
  return t(engineInitReasonKey(reason));
}

interface EngineRecoveryAction {
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
  reason: EngineInitReason | null,
  t: TFunction,
  retry: () => void
): EngineRecoveryAction[] {
  const retryAction = { label: t('common.retry'), onPress: retry, testID: 'engine-retry-button' };
  switch (reason) {
    case FfiInitOutcome.ForwardSchema:
      return [
        {
          label: t('engine.initAction.update'),
          onPress: () => openStorePage(),
          testID: 'engine-update-button',
        },
      ];
    case FfiInitOutcome.StorageUnavailable:
      return [
        {
          label: t('engine.initAction.freeSpace'),
          onPress: () => navigateTo('/cache-settings'),
          testID: 'engine-free-space-button',
        },
        retryAction,
      ];
    case FfiInitOutcome.VersionMismatch:
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
