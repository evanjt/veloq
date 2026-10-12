package com.veloq.debugcrash

import android.content.Context

/**
 * One pending forced render crash, kept in preferences so the request survives
 * the process the broadcast started and is read by the next app launch.
 */
object DebugCrashRequest {
  private const val PREFS = "veloq_debug_crash"
  private const val KEY = "requested"

  fun set(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).commit()
  }

  /** Whether a request was pending; it is cleared either way. */
  fun take(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val requested = prefs.getBoolean(KEY, false)
    if (requested) prefs.edit().remove(KEY).commit()
    return requested
  }
}
