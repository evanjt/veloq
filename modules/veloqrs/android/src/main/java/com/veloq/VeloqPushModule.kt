package com.veloq

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What JavaScript asks of the push path on Android. The wipe cancels queued
 * activity pushes and removes finished records, since both carry athlete and
 * activity ids in WorkManager's database.
 */
class VeloqPushModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VeloqPush")

    AsyncFunction("cancelQueuedActivityPushes") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      ActivityPushWorker.cancelAll(context)
    }
  }
}
