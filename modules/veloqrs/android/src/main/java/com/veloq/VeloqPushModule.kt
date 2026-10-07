package com.veloq

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What JavaScript asks of the push path on Android. The wipe cancels every
 * activity push still queued, since each one carries the athlete id and an
 * activity id in WorkManager's database until it runs.
 */
class VeloqPushModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VeloqPush")

    Function("cancelQueuedActivityPushes") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ActivityPushWorker.cancelAll(context)
    }
  }
}
