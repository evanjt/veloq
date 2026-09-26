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
 * It answers with one for every outcome but the athlete's own switch, a plain
 * entry naming the ride where the ladder had no sentence, because the server
 * no longer sends a placeholder to Android and a ride that reached the phone
 * with no tray entry at all cannot be opened from the tray.
 */
class ActivityPushWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val activityId = inputData.getString(KEY_ACTIVITY_ID) ?: return Result.failure()
    val credential = PushCredential.read(applicationContext)
    if (credential == null) {
      Log.w(TAG, "no credential for $activityId, nothing to fetch with")
      return Result.failure()
    }
    val dbPath = File(applicationContext.filesDir, DB_FILE).absolutePath
    val ready = PushBridge.prepare(dbPath, credential.method, credential.secret, credential.athleteId)
    if (!ready) {
      Log.w(TAG, "the engine would not open for $activityId")
      return Result.failure()
    }
    val json = PushBridge.activityPush(activityId)
    if (json == null) {
      // The athlete turned notifications off, which is the one outcome that
      // posts nothing. Everything else answers with an entry, plain when the
      // ladder had no sentence. Rust recorded which it was and the dashboard
      // reads that; this line is for whoever has logcat attached.
      Log.w(TAG, "nothing to post for $activityId")
      return Result.success()
    }
    val notification = try {
      JSONObject(json)
    } catch (e: Exception) {
      Log.w(TAG, "Rust answered with something that is not JSON for $activityId")
      return Result.failure()
    }
    ActivityNotificationPoster.post(
      applicationContext,
      activityId,
      notification.optString("title"),
      notification.optString("body")
    )
    return Result.success()
  }

  companion object {
    private const val TAG = "VeloqPush"
    private const val KEY_ACTIVITY_ID = "activityId"

    /** The app's database, the same file `WidgetSnapshot` sits beside. */
    const val DB_FILE = "routes.db"

    /**
     * Queue the push for `activityId`. Unique per activity and kept, so the
     * visible push and the silent one behind it, or a webhook delivered
     * twice, cost one run.
     */
    @JvmStatic
    fun enqueue(context: Context, activityId: String) {
      val request = OneTimeWorkRequest.Builder(ActivityPushWorker::class.java)
        .setInputData(Data.Builder().putString(KEY_ACTIVITY_ID, activityId).build())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        request.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      }
      WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork("activity-push-$activityId", ExistingWorkPolicy.KEEP, request.build())
    }
  }
}
