package com.veloq

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import java.io.File

/**
 * The widget snapshot file and its one writer. The app's `VeloqWidget` module and
 * the native workers both write through here, and the providers read the path
 * from here, from `filesDir`, and never compute during rendering.
 */
object WidgetSnapshotFile {
  const val NAME = "widget-snapshot.json"

  /** A write's temporary file is `widget-snapshot<random>.tmp` beside the snapshot. */
  private const val TEMP_PREFIX = "widget-snapshot"
  private const val TEMP_SUFFIX = ".tmp"

  /** Where the snapshot lives under a `filesDir`. */
  @JvmStatic
  fun file(dir: File): File = File(dir, NAME)

  fun write(context: Context, json: String) = write(context.filesDir, json)

  /**
   * Write through a temporary file of its own and a rename, so a provider
   * redrawing at the same moment never reads half a snapshot. The JavaScript
   * thread and the workers write from one process, so the lock orders them and
   * one writer's rename never moves another's unfinished file into place.
   */
  @Synchronized
  fun write(dir: File, json: String) {
    val tmp = File.createTempFile(TEMP_PREFIX, TEMP_SUFFIX, dir)
    try {
      tmp.writeText(json)
      if (!tmp.renameTo(file(dir))) file(dir).writeText(json)
    } finally {
      tmp.delete()
    }
  }

  fun clear(context: Context) = clear(context.filesDir)

  /**
   * Delete the snapshot and any temporary file a killed write left, so the
   * providers draw their placeholder rather than the previous athlete's ride.
   */
  @Synchronized
  fun clear(dir: File) {
    file(dir).delete()
    dir.listFiles { f -> f.name.startsWith(TEMP_PREFIX) && f.name.endsWith(TEMP_SUFFIX) }
      ?.forEach { it.delete() }
  }

  /**
   * Ask every widget provider this app declares to redraw. Found by package
   * rather than by class, because the provider's class name follows the
   * variant's application id. Returns how many widgets were asked, so a caller can tell that none
   * is placed.
   */
  fun redraw(context: Context): Int {
    val app = context.applicationContext
    var asked = 0
    forEachPlaced(app) { provider, ids ->
      asked += ids.size
      app.sendBroadcast(
        Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
          component = provider
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        }
      )
    }
    return asked
  }

  /** How many widgets of this app are placed, across every provider. */
  fun placed(context: Context): Int {
    var count = 0
    forEachPlaced(context.applicationContext) { _, ids -> count += ids.size }
    return count
  }

  private fun forEachPlaced(app: Context, each: (ComponentName, IntArray) -> Unit) {
    val manager = AppWidgetManager.getInstance(app)
    for (info in manager.installedProviders) {
      if (info.provider.packageName != app.packageName) continue
      val ids = manager.getAppWidgetIds(info.provider)
      if (ids.isNotEmpty()) each(info.provider, ids)
    }
  }
}
