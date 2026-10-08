package com.veloq

import androidx.work.ExistingPeriodicWorkPolicy
import org.json.JSONObject

/** Decisions shared by a tap, the timer and the worker that answers them. */
internal object WidgetRefreshDecision {
  /**
   * The timer runs while an athlete is signed in and a widget is placed to show the result. Null
   * cancels it. KEEP leaves a running schedule alone, so asking again never resets its clock.
   */
  fun periodic(signedIn: Boolean, placed: Int): ExistingPeriodicWorkPolicy? =
    if (signedIn && placed > 0) ExistingPeriodicWorkPolicy.KEEP else null

  fun canQueue(credential: PushCredential.Stored, busy: Boolean): Boolean =
    credential is PushCredential.Stored.Ready && !busy

  /** Null is a request to leave the last good file untouched. */
  fun snapshot(response: String?): String? = try {
    response?.let { JSONObject(it).optJSONObject("snapshot")?.toString() }
  } catch (_: Exception) {
    null
  }
}
