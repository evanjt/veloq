package __PKG__.widget

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import __PKG__.R

/**
 * Record in the Quick Settings shade, reachable with the phone locked. The tile
 * is the same deep link every other record surface uses, so one rule decides the
 * sport, and its label is the snapshot's, so the tile holds no i18n and no
 * sport-to-name map.
 */
class RecordTileService : TileService() {
  override fun onStartListening() {
    val snap = WidgetSnapshot.read(this)
    qsTile?.apply {
      label = snap?.launcherShortcuts?.firstOrNull()?.label ?: getString(R.string.app_name)
      state = Tile.STATE_INACTIVE
      updateTile()
    }
  }

  override fun onClick() {
    val snap = WidgetSnapshot.read(this)
    val intent =
      Intent(Intent.ACTION_VIEW, Uri.parse(WidgetRenderer.recordUrl(snap)))
        .apply {
          `package` = packageName
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    if (TileLaunch.takesPendingIntent(Build.VERSION.SDK_INT)) {
      val pending =
        PendingIntent.getActivity(
          this,
          0,
          intent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
