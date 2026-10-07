/**
 * The activity pushes Android queues in WorkManager, each named for its
 * athlete and activity (`ActivityPushWorker.enqueue`). The wipe cancels queued
 * jobs and prunes finished records carrying the previous athlete's ids.
 *
 * Only Android queues them. `requireOptionalNativeModule` answers null on iOS
 * and on web, where there is nothing to cancel.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

interface VeloqPushModule {
  cancelQueuedActivityPushes(): Promise<void>;
}

/** Cancel queued pushes and prune finished records. A failure leaves the wipe going. */
export async function cancelQueuedActivityPushes(): Promise<void> {
  try {
    await requireOptionalNativeModule<VeloqPushModule>('VeloqPush')?.cancelQueuedActivityPushes();
  } catch {
    // A module that cannot answer must not stop the rest of the wipe.
  }
}
