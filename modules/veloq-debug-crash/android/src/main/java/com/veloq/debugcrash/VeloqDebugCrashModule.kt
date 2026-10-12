package com.veloq.debugcrash

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Answers whether a forced render crash was requested, and spends the request.
 * `DebugCrashRequest` comes from the build type's source set: the debug one
 * reads what the debug receiver stored, the release one always answers no.
 */
class VeloqDebugCrashModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VeloqDebugCrash")

    Function("takeRequest") {
      val context = appContext.reactContext ?: return@Function false
      DebugCrashRequest.take(context)
    }
  }
}
