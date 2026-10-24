package com.veloq

import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import org.json.JSONObject

/** Decisions shared by a tap, the timer and the worker that answers them. */
internal object WidgetRefreshDecision {
  /**
   * The timer runs while an athlete is signed in and a widget is placed to show the result. Null
   * cancels it. KEEP leaves a running schedule alone, so asking again never resets its clock.
   */
  fun periodic(signedIn: Boolean, placed: Int): ExistingPeriodicWorkPolicy? =
    if (signedIn && placed > 0) ExistingPeriodicWorkPolicy.KEEP else null

  /**
   * A tap is an athlete waiting on the widget, so it is expedited where the OS grants that
   * (Android 12 and later; below, an expedited request is a foreground service). Plain work
   * waits on the app's standby bucket, which for an app that has not been opened is hours, and
   * the tap then appears to do nothing until the app is opened. Past its quota it still runs, as
   * plain work.
   */
  fun tapRequest(sdk: Int = Build.VERSION.SDK_INT): OneTimeWorkRequest {
    val request = OneTimeWorkRequest.Builder(NativeWidgetRefreshWorker::class.java)
    if (sdk >= Build.VERSION_CODES.S) {
      request.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
    }
    return request.build()
  }

  fun canQueue(credential: PushCredential.Stored, busy: Boolean): Boolean =
    credential is PushCredential.Stored.Ready && !busy

  /** Null is a request to leave the last good file untouched. */
  fun snapshot(response: String?): String? = try {
    response?.let { JSONObject(it).optJSONObject("snapshot")?.toString() }
  } catch (_: Exception) {
    null
  }
}
