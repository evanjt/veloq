package com.veloq.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import com.veloq.WidgetSnapshotFile
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridges the JS snapshot pipeline to the Android home-screen widget: writes the
 * pre-formatted JSON through `WidgetSnapshotFile`, the file the provider reads, then
 * broadcasts an update to every widget provider this app declares so each instance
 * redraws. The provider never computes, it only renders this file.
 */
class VeloqWidgetModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VeloqWidget")

    Function("writeSnapshot") { json: String ->
      WidgetSnapshotFile.write(context, json)
    }

    // The wipe deletes the file and any half-written copy, so the provider
    // draws its placeholder rather than the previous athlete's last ride.
    Function("clearSnapshot") {
      WidgetSnapshotFile.clear(context)
    }

    /**
     * The recent sports as launcher shortcuts, most recent first, taken from the
     * same pre-localised list the snapshot carries. Each fires the deep link that
     * opens the app already recording, so a long press on the icon is one tap to
     * a ride, and draws its sport category's glyph, so the sports differ by more
     * than their label. An empty list clears them rather than leaving a stale
     * sport behind.
     */
    Function("publishRecordShortcuts") { shortcuts: List<Map<String, String>> ->
      val ctx = context.applicationContext
      val entries =
        shortcuts.mapNotNull { entry ->
          val type = entry["type"]?.trim().orEmpty()
          val url = entry["url"]?.trim().orEmpty()
          if (type.isEmpty() || url.isEmpty()) return@mapNotNull null
          val label = entry["label"]?.trim().orEmpty().ifEmpty { type }
          val intent =
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { `package` = ctx.packageName }
          ShortcutInfoCompat.Builder(ctx, "record-$type")
            .setShortLabel(label)
            .setLongLabel(label)
            .setIcon(RecordShortcutIcons.icon(ctx, entry["glyph"]))
            .setIntent(intent)
            .build()
        }
      if (entries.isEmpty()) {
        ShortcutManagerCompat.removeAllDynamicShortcuts(ctx)
      } else {
        ShortcutManagerCompat.setDynamicShortcuts(ctx, entries)
      }
    }

    Function("reloadWidgets") {
      WidgetSnapshotFile.redraw(context)
      Unit
    }
  }
}
