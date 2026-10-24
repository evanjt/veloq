package com.veloq

import android.content.Context
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters

/** A widget tap's native refresh, scheduled once while a run is active. */
class NativeWidgetRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    NativeWidgetSnapshot.run(applicationContext)
    return Result.success()
  }

  companion object {
    private const val TAG = "VeloqWidgetRefresh"
    private const val UNIQUE_NAME = "native-widget-refresh"

    @JvmStatic
    fun enqueue(context: Context) {
      val app = context.applicationContext
      val credential = NativeWidgetSnapshot.credential(app)
      if (!NativeWidgetSnapshot.begin(app, credential)) return
      try {
        WorkManager.getInstance(app).enqueueUniqueWork(
          UNIQUE_NAME, ExistingWorkPolicy.KEEP,
          WidgetRefreshDecision.tapRequest())
        WidgetSnapshotFile.redraw(app)
      } catch (e: Exception) {
        NativeWidgetSnapshot.finish(app)
        Log.w(TAG, "could not schedule widget refresh", e)
      }
    }
  }
}
