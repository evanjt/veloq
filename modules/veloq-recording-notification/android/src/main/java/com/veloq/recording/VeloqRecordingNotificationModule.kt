package com.veloq.recording

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.PowerManager
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

// The service posts its notification asynchronously after the app backgrounds,
// so the first update can arrive before there is anything to replace.
private const val RETRY_DELAY_MS = 400L
private const val MAX_RETRIES = 6

/**
 * Re-posts the ride's foreground-service notification with the ride on it.
 *
 * A GPS ride's service is expo-location's and nothing here owns it. Android
 * identifies a notification by its id and channel, so posting the same pair
 * replaces the content of the one `startForeground` put up while leaving the
 * service's lifecycle to expo-location, which is what the recording's
 * kill-and-restore path depends on. An indoor ride's service is
 * [IndoorRecordingService], started and stopped from here.
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
    Function("update") { json: String ->
      LiveRide.reported = true
      onWorker {
        val payload = JSONObject(json)
        armInterruptedRide(payload)
        post(payload, 0)
      }
    }

    // `manager.notify` took ownership of the id from the service, so nothing in
    // the service's lifecycle takes the notification down. Cancelling is the
    // only thing that does.
    Function("clear") {
      LiveRide.reported = false
      onWorker {
        cancelRetry()
        cancelNotification()
        InterruptedRideNotifier.of(context).disarmed()
      }
    }

    // Synchronous, so the channel exists before the location service starts and
    // creates its own. Creating a channel is one binder call.
    Function("nameChannel") { name: String, description: String ->
      val spec = RecordingChannel.spec(context.packageName, name, description) ?: return@Function
      val manager = context.getSystemService(NotificationManager::class.java) ?: return@Function
      manager.createNotificationChannel(
        NotificationChannel(spec.id, spec.name, spec.importance).apply {
          this.description = spec.description
        }
      )
    }

    Function("clearInterrupted") { onWorker { InterruptedRideNotifier.cancel(context) } }

    // Whether the athlete has exempted the app from battery optimisation, so the
    // record screen asks only while a long ride can still be killed. A binder
    // call into the power service and nothing more, so it runs on the caller.
    Function("batteryOptimisationExempt") {
      val power = context.getSystemService(PowerManager::class.java)
      power?.isIgnoringBatteryOptimizations(context.packageName) == true
    }

    Function("startIndoorService") { json: String ->
      IndoorRecordingService.start(context, JSONObject(json).optString("title"))
    }

    Function("stopIndoorService") { IndoorRecordingService.stop(context) }

    Function("drainPendingActions") { RecordingActionReceiver.drainPending(context) }

    // Whether the location foreground service is actually running.
    Function("serviceRunning") { LiveRide.locationServiceRunning(context) }
  }

  /**
   * A live ride, so a process that dies from here on owes the rider a notice at
   * its next start. Live also means recording again, so a notice from an
   * earlier death has been answered: arming after a start took the notice is
   * exactly that moment, and every later batch has nothing to cancel.
   */
  private fun armInterruptedRide(payload: JSONObject) {
    val interrupted = payload.optJSONObject("interrupted")
    val notice = InterruptedRide.notice(
      payload.optLong("session"),
      interrupted?.optString("channel"),
      interrupted?.optString("title"),
      interrupted?.optString("body")
    ) ?: return
    if (InterruptedRideNotifier.of(context).armed(notice)) InterruptedRideNotifier.cancel(context)
  }

  /**
   * The ride's foreground-service notification, expo-location's for a GPS ride
   * or [IndoorRecordingService]'s for an indoor one, or null when there is none.
   */
  private fun serviceNotification(): android.service.notification.StatusBarNotification? {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return null
    return manager.activeNotifications.firstOrNull {
      val channel = it.notification.channelId ?: return@firstOrNull false
      channel.endsWith(":$LOCATION_TASK_NAME") || channel.endsWith(":$INDOOR_CHANNEL_SUFFIX")
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
    val accent = parseColor(payload.optString("accentColor"))
    val builder = NotificationCompat.Builder(context, channelId)
      .setSmallIcon(smallIcon())
      .setContentTitle(payload.optString("title"))
      .setContentText(payload.optString("body"))
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setVisibility(RecordingChannel.LOCK_SCREEN_VISIBILITY)
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

    builder.setContentIntent(RideLink.recording(context.packageName).pendingIntent(context))

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
