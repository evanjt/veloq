package __PKG__.widget

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.TileService
import com.veloq.recording.LiveRide
import __PKG__.R

/**
 * Record in the Quick Settings shade, reachable with the phone locked. Idle, the
 * tile is the same deep link every other record surface uses, so one rule
 * decides the sport, and its label is the snapshot's, so the tile holds no
 * sport-to-name map. While a ride records it shows that and opens the ride.
 *
 * The tile is not an active tile, so Android binds it and calls
 * `onStartListening` each time the shade shows it, and every opening reads the
 * ride afresh.
 */
class RecordTileService : TileService() {
  override fun onStartListening() {
    val face = face()
    qsTile?.apply {
      label = face.label
      state = face.state
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) subtitle = face.subtitle
      updateTile()
    }
  }

  override fun onClick() {
    val intent =
      Intent(Intent.ACTION_VIEW, Uri.parse(face().url))
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

  private fun face(): RecordTileFace {
    val snap = WidgetSnapshot.read(this)
    return RecordTile.face(
      LiveRide.recording(this),
      snap,
      getString(R.string.app_name),
      getString(R.string.widget_recording),
      WidgetRenderer.recordUrl(snap),
    )
  }
}
