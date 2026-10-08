package com.veloq

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * The widget's data refresh with the app closed: the same native run a tap on the refresh control
 * queues, on a six-hour timer. Without it a widget whose app has not run keeps the numbers of the
 * last foreground sync however old they are.
 *
 * It runs only with a network and a battery that is not low, so a tick with neither is deferred
 * rather than spent. A run that pulls nothing writes the stored rows, and the age line then reads
 * from the last sync. A run already going from a tap takes this tick's place.
 *
 * The schedule is kept while an athlete is signed in and a widget is placed, and cancelled
 * otherwise. Each provider asks on every update and on its last removal, the app asks at start,
 * and every tick asks again, so a sign-out or a removed widget ends it within one redraw.
 */
class WidgetDataRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val app = applicationContext
    if (!reconcile(app)) return Result.success()
    if (NativeWidgetSnapshot.begin(app, NativeWidgetSnapshot.credential(app))) {
      NativeWidgetSnapshot.run(app)
    }
    return Result.success()
  }

  companion object {
    private const val TAG = "VeloqWidgetRefresh"
    private const val UNIQUE_NAME = "widget-data-refresh"
    private const val PERIOD_HOURS = 6L

    /** Called by a provider while it draws, which proves a widget is placed. */
    @JvmStatic
    fun widgetPlaced(context: Context) {
      settle(context, 1)
    }

    /** Count the placed widgets first, for a caller that cannot know, such as a removal. */
    @JvmStatic
    fun reconcile(context: Context): Boolean = settle(context, WidgetSnapshotFile.placed(context))

    private fun settle(context: Context, placed: Int): Boolean {
      val app = context.applicationContext
      return try {
        val manager = WorkManager.getInstance(app)
        val policy = WidgetRefreshDecision.periodic(PushCredential.isSignedIn(app), placed)
        if (policy == null) {
          manager.cancelUniqueWork(UNIQUE_NAME)
          false
        } else {
          manager.enqueueUniquePeriodicWork(UNIQUE_NAME, policy, request())
          true
        }
      } catch (e: Exception) {
        Log.w(TAG, "could not update the periodic widget refresh", e)
        false
      }
    }

    private fun request(): PeriodicWorkRequest =
      PeriodicWorkRequest.Builder(WidgetDataRefreshWorker::class.java, PERIOD_HOURS, TimeUnit.HOURS)
        // Scheduling follows a placement or an app start, both of which just drew fresh data.
        .setInitialDelay(PERIOD_HOURS, TimeUnit.HOURS)
        .setConstraints(
          Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build())
        .build()
  }
}
