package com.veloq

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * One redraw of every placed widget from the snapshot already on disk.
 *
 * The widget's age line is computed when it is drawn, and nothing redraws a widget whose app is
 * not running, so an unscheduled line would stop at the minute it was drawn. This draws it again
 * on WorkManager's shortest period. It reads a file and touches no network and no database.
 *
 * With no widget placed it cancels itself, so a removed widget leaves no schedule behind.
 */
class WidgetAgeRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    if (WidgetSnapshotFile.redraw(applicationContext) == 0) cancel(applicationContext)
    return Result.success()
  }

  companion object {
    private const val UNIQUE_NAME = "widget-age-refresh"
    private const val PERIOD_MINUTES = 15L

    /** Keep one schedule however often a provider asks, so a redraw never resets its clock. */
    @JvmStatic
    fun schedule(context: Context) {
      val request =
        PeriodicWorkRequest.Builder(WidgetAgeRefreshWorker::class.java, PERIOD_MINUTES, TimeUnit.MINUTES)
          .build()
      WorkManager.getInstance(context.applicationContext)
        .enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    @JvmStatic
    fun cancel(context: Context) {
      WorkManager.getInstance(context.applicationContext).cancelUniqueWork(UNIQUE_NAME)
    }
  }
}
