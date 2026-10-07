/**
 * The activity pushes Android queues in WorkManager, each named for its
 * athlete and activity (`ActivityPushWorker.enqueue`). A job still queued when
 * the library goes would keep the previous athlete's ids in WorkManager's
 * database, so the wipe cancels them all.
 *
 * Only Android queues them. `requireOptionalNativeModule` answers null on iOS
 * and on web, where there is nothing to cancel.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

interface VeloqPushModule {
  cancelQueuedActivityPushes(): void;
}

/** Cancel every activity push still queued. Best effort: a failure leaves the wipe going. */
export function cancelQueuedActivityPushes(): void {
  try {
    requireOptionalNativeModule<VeloqPushModule>('VeloqPush')?.cancelQueuedActivityPushes();
  } catch {
    // A module that cannot answer must not stop the rest of the wipe.
  }
}
