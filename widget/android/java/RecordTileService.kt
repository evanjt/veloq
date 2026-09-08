package __PKG__.widget

import android.content.Intent
import android.net.Uri
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

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
      label = snap?.recordShortcuts?.firstOrNull()?.label ?: getString(R.string.app_name)
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
    // Deprecated on 34 in favour of the PendingIntent overload, which is 34-only,
    // and minSdk here is below that. Both unlock first, which is the point.
    @Suppress("DEPRECATION")
    startActivityAndCollapse(intent)
  }
}
