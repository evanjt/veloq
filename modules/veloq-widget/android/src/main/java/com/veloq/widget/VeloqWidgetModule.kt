package com.veloq.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// Infrastructure constant (not theme). The AppWidgetProvider reads the same file from
// the app's private filesDir — provider and module run in the same app process.
private const val SNAPSHOT_FILE = "widget-snapshot.json"

/**
 * Bridges the JS snapshot pipeline to the Android home-screen widget: writes the
 * pre-formatted JSON to the app's filesDir (where the provider reads it), then
 * broadcasts an update to every widget provider this app declares so each instance
 * redraws. The provider never computes — it only renders this file.
 */
class VeloqWidgetModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VeloqWidget")

    Function("writeSnapshot") { json: String ->
      File(context.filesDir, SNAPSHOT_FILE).writeText(json)
    }

    Function("reloadWidgets") {
      val ctx = context.applicationContext
      val manager = AppWidgetManager.getInstance(ctx)
      val pkg = ctx.packageName
      // Notify whatever widget providers this app installs, without hardcoding the
      // provider class (its FQN diverges from applicationId under the dev/prod split).
      for (info in manager.installedProviders) {
        if (info.provider.packageName != pkg) continue
        val ids = manager.getAppWidgetIds(info.provider)
        if (ids.isEmpty()) continue
        val intent =
          Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
            component = info.provider
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
          }
        ctx.sendBroadcast(intent)
      }
    }
  }
}
