package com.veloq

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import java.io.File

/**
 * The widget snapshot file, for a writer with no JavaScript. The app writes the
 * same file through the `VeloqWidget` module, and the providers read it from
 * `filesDir` and never compute.
 */
internal object WidgetSnapshotFile {
  const val NAME = "widget-snapshot.json"

  /**
   * Write through a temporary file and a rename, so a provider redrawing at the
   * same moment never reads half a snapshot.
   */
  fun write(context: Context, json: String) {
    val dir = context.filesDir
    val tmp = File(dir, "$NAME.tmp")
    val dest = File(dir, NAME)
    tmp.writeText(json)
    if (!tmp.renameTo(dest)) {
      dest.writeText(json)
      tmp.delete()
    }
  }

  /**
   * Ask every widget provider this app declares to redraw. Found by package
   * rather than by class, because the provider's class name follows the
   * variant's application id.
   */
  fun redraw(context: Context) {
    val app = context.applicationContext
    val manager = AppWidgetManager.getInstance(app)
    for (info in manager.installedProviders) {
      if (info.provider.packageName != app.packageName) continue
      val ids = manager.getAppWidgetIds(info.provider)
      if (ids.isEmpty()) continue
      app.sendBroadcast(
        Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
          component = info.provider
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        }
      )
    }
  }
}
