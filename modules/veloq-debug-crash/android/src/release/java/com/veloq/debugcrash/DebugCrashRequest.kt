package com.veloq.debugcrash

import android.content.Context

/** A release build carries no trigger, so no request is ever pending. */
object DebugCrashRequest {
  @Suppress("UNUSED_PARAMETER")
  fun take(context: Context): Boolean = false
}
