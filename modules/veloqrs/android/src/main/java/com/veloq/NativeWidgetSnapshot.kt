package com.veloq

import android.content.Context
import android.os.SystemClock
import android.util.Log
import java.io.File

/** One native snapshot writer for push, button and timer refreshes with no JavaScript running. */
object NativeWidgetSnapshot {
  private const val TAG = "VeloqWidgetRefresh"
  private const val PREFS = "native-widget-refresh"
  private const val STARTED_AT = "startedAtElapsed"
  private const val BUSY_LIMIT_MS = 120_000L

  fun credential(context: Context): PushCredential.Stored = PushCredential.read(context)

  fun current(context: Context): Boolean = write(context, PushBridge.widgetSnapshot())

  /** The Rust result contains the pull status and a snapshot of either fresh or stored rows. */
  fun refresh(context: Context, credential: PushCredential): Boolean {
    val answer = PushBridge.widgetRefresh(
      File(context.filesDir, ActivityPushWorker.DB_FILE).absolutePath,
      credential.method, credential.secret, credential.athleteId)
    return write(context, WidgetRefreshDecision.snapshot(answer))
  }

  /** One refresh run, from a tap or the timer, once [begin] has taken the busy slot. */
  fun run(context: Context) {
    val started = startedAt(context)
    var wrote = false
    try {
      val credential = credential(context)
      if (credential is PushCredential.Stored.Ready) {
        wrote = refresh(context, credential.credential)
      }
    } catch (e: Exception) {
      Log.w(TAG, "native widget refresh failed; keeping the last snapshot", e)
    } finally {
      finish(context)
      logRun(started, wrote)
    }
  }

  /** A missing native answer keeps the file and its age. */
  private fun write(context: Context, json: String?): Boolean {
    if (json == null) return false
    WidgetSnapshotFile.write(context, json)
    WidgetSnapshotFile.redraw(context)
    return true
  }

  @Synchronized
  fun begin(context: Context, credential: PushCredential.Stored): Boolean {
    if (!WidgetRefreshDecision.canQueue(credential, isBusy(context))) return false
    prefs(context).edit().putLong(STARTED_AT, SystemClock.elapsedRealtime()).apply()
    return true
  }

  fun isBusy(context: Context): Boolean {
    val started = prefs(context).getLong(STARTED_AT, -1)
    val age = SystemClock.elapsedRealtime() - started
    return started >= 0 && age >= 0 && age < BUSY_LIMIT_MS
  }

  fun startedAt(context: Context): Long = prefs(context).getLong(STARTED_AT, -1)

  fun finish(context: Context) {
    prefs(context).edit().remove(STARTED_AT).apply()
    WidgetSnapshotFile.redraw(context)
  }

  fun logRun(started: Long, wrote: Boolean) {
    val duration = if (started >= 0) SystemClock.elapsedRealtime() - started else -1
    val hwm = try {
      File("/proc/self/status").useLines { lines -> lines.firstOrNull { it.startsWith("VmHWM:") } }
    } catch (_: Exception) { null }
    Log.i(TAG, "redraw completed in ${duration}ms; wrote=$wrote; ${hwm ?: "VmHWM unavailable"}")
  }

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
