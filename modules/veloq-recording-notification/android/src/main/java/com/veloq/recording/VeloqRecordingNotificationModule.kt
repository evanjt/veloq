package com.veloq.recording

import android.app.ActivityManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.util.Log
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONObject

// Must match BACKGROUND_LOCATION_TASK in src/features/recording/lib/backgroundLocation.ts.
// expo-location names the foreground service's channel "<appId>:<taskName>"
// (LocationTaskService.onStartCommand), which is the only handle it exposes.
private const val LOCATION_TASK_NAME = "veloq-background-location"

// The service expo-location runs the location task in. Named rather than derived
// because `getRunningServices` reports a class name and nothing else identifies
// it.
private const val LOCATION_SERVICE_CLASS = "expo.modules.location.services.LocationTaskService"

// The service posts its notification asynchronously after the app backgrounds,
// so the first update can arrive before there is anything to replace.
private const val RETRY_DELAY_MS = 400L
private const val MAX_RETRIES = 6

/**
 * Re-posts expo-location's foreground-service notification with the ride on it.
 *
 * Nothing here owns the service. Android identifies a notification by its id and
 * channel, so posting the same pair replaces the content of the one
 * `startForeground` put up while leaving the service's lifecycle to
 * expo-location, which is what `B205`'s kill-and-restore path depends on.
 */
class VeloqRecordingNotificationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // One thread for every post, retry and cancel.
  //
  // `build` rasterises a 1024x448 trace before `notify`, which is 1.8 MB and a
  // path draw, and `update` is called once per location batch and on every lap.
  // As a synchronous `Function` all of that ran on the JS thread.
  //
  // Serial rather than pooled, for two reasons. Two posts must not land out of
  // order, or the notification shows the older ride. And the scratch bitmap
  // `RecordingTrace` reuses belongs to whichever thread draws it, so there must
  // only ever be one.
  private val worker = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "veloq-recording-notification").apply { isDaemon = true }
  }
  private var pendingRetry: ScheduledFuture<*>? = null

  override fun definition() = ModuleDefinition {
    Name("VeloqRecordingNotification")

    Events("onAction")

    OnCreate { live = this@VeloqRecordingNotificationModule }

    OnDestroy {
      if (live === this@VeloqRecordingNotificationModule) live = null
      onWorker { cancelRetry() }
      worker.shutdown()
    }

    // The JSON is parsed on the worker too. A trace of several hundred points
    // is a page of parsing, and doing it here to hand over a `JSONObject` would
    // leave the JS thread paying for the half that is cheapest to move.
    Function("update") { json: String -> onWorker { post(JSONObject(json), 0) } }

    // `manager.notify` took ownership of the id from the service, so nothing in
    // the service's lifecycle takes the notification down. Cancelling is the
    // only thing that does.
    Function("clear") {
      onWorker {
        cancelRetry()
        cancelNotification()
      }
    }

    Function("drainPendingActions") { RecordingActionReceiver.drainPending(context) }

    // Whether the location foreground service is actually running.
    //
    // Two cheaper answers were measured on a device and both lie. The task
    // registry (`hasStartedLocationUpdatesAsync`) answers whether the task is
    // registered, and a ride that ended abnormally leaves it registered across a
    // process restart. The service's notification is worse: `manager.notify`
    // takes ownership of the id, so a re-posted one outlives both the service
    // and the process, and was measured still on screen with no app process
    // alive at all.
    //
    // `getRunningServices` is deprecated and still correct here: since Android 8
    // it returns only the caller's own services, which is exactly the scope
    // wanted. A dead service is simply absent, and nothing stale can add one.
    @Suppress("DEPRECATION")
    Function("serviceRunning") {
      val manager = context.getSystemService(ActivityManager::class.java)
      manager?.getRunningServices(Int.MAX_VALUE)?.any {
        it.service.className == LOCATION_SERVICE_CLASS && it.foreground
      } == true
    }
  }

  /** expo-location's own foreground-service notification, or null when there is none. */
  private fun serviceNotification(): android.service.notification.StatusBarNotification? {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return null
    return manager.activeNotifications.firstOrNull {
      it.notification.channelId?.endsWith(":$LOCATION_TASK_NAME") == true
    }
  }

  private fun cancelNotification() {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val target = serviceNotification() ?: return
    manager.cancel(target.id)
  }

  private fun cancelRetry() {
    pendingRetry?.cancel(false)
    pendingRetry = null
  }

  /**
   * Run `block` on the worker, swallowing what it throws.
   *
   * A `Function` body throws back into JavaScript, which the caller catches
   * (`updateRecordingNotification`). Off the thread there is nobody to catch
   * it, and an uncaught throw on an executor takes the process down, so the one
   * that matters, a react context lost mid-ride, is caught here instead.
   */
  private fun onWorker(block: () -> Unit) {
    try {
      worker.execute {
        try {
          block()
        } catch (e: Exception) {
          Log.w(TAG, "recording notification update failed", e)
        }
      }
    } catch (e: RejectedExecutionException) {
      // The module is being torn down. There is nothing left to draw on.
    }
  }

  private fun post(payload: JSONObject, attempt: Int) {
    cancelRetry()
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val target = serviceNotification()
    if (target == null) {
      if (attempt >= MAX_RETRIES) return
      pendingRetry = worker.schedule(
        { onWorker { post(payload, attempt + 1) } },
        RETRY_DELAY_MS,
        TimeUnit.MILLISECONDS
      )
      return
    }
    manager.notify(target.id, build(payload, target.notification.channelId))
  }

  private fun build(payload: JSONObject, channelId: String): android.app.Notification {
    val accent = parseColor(payload.optString("traceColor"))
    val builder = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(smallIcon())
      .setContentTitle(payload.optString("title"))
      .setContentText(payload.optString("body"))
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setColorized(true)
      .setColor(accent)

    // Android ticks the chronometer itself, so a suspended process still shows a
    // moving clock. A paused ride shows the frozen figure instead: a running
    // chronometer would count time the ride did not spend moving.
    if (payload.optBoolean("running")) {
      builder.setUsesChronometer(true).setWhen(payload.optLong("chronometerBase"))
    } else {
      builder.setUsesChronometer(false).setShowWhen(false)
      builder.setSubText(payload.optString("elapsedText"))
    }

    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      it.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
      builder.setContentIntent(
        PendingIntent.getActivity(
          context,
          0,
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
    }

    val actions = payload.optJSONArray("actions")
    for (i in 0 until (actions?.length() ?: 0)) {
      val action = actions!!.getJSONObject(i)
      val id = action.optString("id")
      builder.addAction(0, action.optString("label"), broadcast(id, i, payload.optLong("session")))
    }

    trace(payload)?.let { bitmap ->
      builder.setLargeIcon(bitmap)
      builder.setStyle(
        NotificationCompat.BigPictureStyle()
          .bigPicture(bitmap)
          // Otherwise the same trace shows twice once the notification expands.
          .bigLargeIcon(null as android.graphics.Bitmap?)
      )
    }

    return builder.build()
  }

  private fun trace(payload: JSONObject): android.graphics.Bitmap? {
    val array = payload.optJSONArray("trace") ?: return null
    val flat = DoubleArray(array.length()) { array.optDouble(it) }
    return RecordingTrace.render(flat, parseColor(payload.optString("traceColor")))
  }

  /**
   * `session` is the ride the button belongs to. The notification outlives the
   * process that drew it, so without it a press on a stale notification is
   * replayed against whichever ride is live when the queue is next drained.
   *
   * `FLAG_UPDATE_CURRENT` is what keeps the session current: the same request
   * code is reused across posts, so the extras of the live intent are rewritten
   * each time the notification is updated rather than a new one being made.
   */
  private fun broadcast(action: String, requestCode: Int, session: Long): PendingIntent {
    val intent = Intent(context, RecordingActionReceiver::class.java)
      .setAction(BROADCAST_ACTION)
      .putExtra(ACTION_EXTRA, action)
      .putExtra(SESSION_EXTRA, session)
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun smallIcon(): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }

  private fun parseColor(value: String?): Int =
    try {
      Color.parseColor(value)
    } catch (e: Exception) {
      Color.WHITE
    }

  companion object {
    private const val TAG = "VeloqRecordingNotif"

    // The receiver runs in this process but is constructed by the system, so the
    // live module is reached through here rather than through an injection.
    private var live: VeloqRecordingNotificationModule? = null

    /** True when a JavaScript runtime was listening and took the press. */
    fun dispatch(action: String, session: Long): Boolean {
      val module = live ?: return false
      return try {
        module.sendEvent("onAction", mapOf("action" to action, "session" to session))
        true
      } catch (e: Exception) {
        false
      }
    }
  }
}
