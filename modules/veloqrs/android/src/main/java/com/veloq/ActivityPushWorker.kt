package com.veloq

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File
import org.json.JSONObject

/**
 * One activity push, off the messaging service's thread.
 *
 * `onMessageReceived` has a ceiling of twenty seconds and the enrichment
 * waits on two fetches of up to fifteen each, so the service hands the id
 * here and returns. Expedited on Android 12 and later, where that is a job
 * with a budget the OS grants for exactly this; plain work below, where an
 * expedited request is a foreground service and a tray entry of its own.
 *
 * The worker carries what a cold process lacks: the database path, which is
 * the one `routeDbLocation.ts` gives Android, and the credential out of the
 * secure store. Rust does the rest and answers with the notification to post.
 *
 * It posts nothing on a signed-out device and nothing for another athlete's push. It answers
 * with one for every other outcome, a plain entry naming the ride where the ladder had no sentence, because the server
 * no longer sends a placeholder to Android and a ride that reached the phone
 * with no tray entry at all cannot be opened from the tray.
 */
class ActivityPushWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val activityId = inputData.getString(KEY_ACTIVITY_ID) ?: return Result.failure()
    val athleteId = inputData.getString(KEY_ATHLETE_ID) ?: return Result.failure()
    val gate = ActivityPushResponse.gate(PushCredential.read(applicationContext), athleteId)
    if (gate == ActivityPushResponse.Gate.Silent) {
      Log.w(TAG, "signed out or another athlete's push for $activityId, posting nothing")
      return Result.success()
    }
    val credential = (gate as? ActivityPushResponse.Gate.Ready)?.credential
    val dbPath = File(applicationContext.filesDir, DB_FILE).absolutePath
    val ready = if (credential != null) {
      PushBridge.prepare(dbPath, credential.method, credential.secret, credential.athleteId)
    } else {
      PushBridge.open(dbPath)
      false
    }
    val unavailableReason = if (credential == null) "missing credential"
      else if (!ready) "engine or credential refused"
      else null
    val json = if (ready) PushBridge.activityPush(activityId, athleteId) else null
    val decision = ActivityPushResponse.resolve(
      json,
      unavailableReason,
      { PushBridge.fallbackNotification() },
      { reason -> PushBridge.recordFailure(activityId, reason) }
    )
    if (decision.failureReason != null) {
      Log.w(TAG, "${decision.failureReason} for $activityId, posting plain entry")
    }
    val notification = decision.notification
    if (notification == null) {
      if (decision.failureReason != null) {
        Log.w(TAG, "plain entry unavailable for $activityId, retrying")
        return Result.retry()
      }
      Log.w(TAG, "notifications off or athlete mismatch for $activityId")
      return Result.success()
    }
    ActivityNotificationPoster.post(
      applicationContext,
      activityId,
      athleteId,
      notification.optString("title"),
      notification.optString("body")
    )
    if (decision.refreshesWidget) refreshWidget(activityId)
    return Result.success()
  }

  /**
   * Rewrite the widget snapshot for the ride just stored. The app writes it
   * when it next runs, and until then the widget would show the form, fitness
   * and latest ride from before this one. A failure here costs the widget a
   * refresh and never the push, which has already posted.
   */
  private fun refreshWidget(activityId: String) {
    try {
      val json = PushBridge.widgetSnapshot()
      if (json == null) {
        Log.w(TAG, "no widget snapshot after $activityId, keeping the last one")
        return
      }
      WidgetSnapshotFile.write(applicationContext, json)
      WidgetSnapshotFile.redraw(applicationContext)
    } catch (e: Exception) {
      Log.w(TAG, "widget refresh after $activityId failed", e)
    }
  }

  companion object {
    private const val TAG = "VeloqPush"
    private const val KEY_ACTIVITY_ID = "activityId"
    private const val KEY_ATHLETE_ID = "athleteId"

    /** The app's database, the same file the widget snapshot sits beside. */
    const val DB_FILE = "routes.db"

    /**
     * Queue the push for `activityId`. Unique per activity and kept, so the
     * visible push and the silent one behind it, or a webhook delivered
     * twice, cost one run.
     */
    @JvmStatic
    fun enqueue(context: Context, activityId: String, athleteId: String) {
      val request = OneTimeWorkRequest.Builder(ActivityPushWorker::class.java)
        .setInputData(Data.Builder()
          .putString(KEY_ACTIVITY_ID, activityId)
          .putString(KEY_ATHLETE_ID, athleteId)
          .build())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        request.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      }
      WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork("activity-push-$athleteId-$activityId", ExistingWorkPolicy.KEEP, request.build())
    }

    /**
     * Cancel every push still queued, whoever it was for. WorkManager tags
     * each request with its worker's class name, so this reaches the jobs an
     * older build queued as well.
     */
    @JvmStatic
    fun cancelAll(context: Context) {
      WorkManager.getInstance(context.applicationContext)
        .cancelAllWorkByTag(ActivityPushWorker::class.java.name)
    }
  }
}
