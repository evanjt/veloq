package __PKG__.widget

import android.service.quicksettings.Tile

/** What the Quick Settings tile shows and what a tap on it opens. */
data class RecordTileFace(val state: Int, val label: String, val subtitle: String?, val url: String)

/**
 * The tile's one decision. A tile reflects what it controls, so a ride that is
 * recording lights it and says so, and a tap goes to the ride rather than
 * starting another. With no ride it is a shortcut to the most recent sport.
 */
object RecordTile {
  // The record entry, which opens the ride already live. The same link the ride
  // notification opens.
  const val LIVE_URL = "veloq://record"

  fun face(
    live: Boolean,
    snap: WidgetSnapshot?,
    appName: String,
    recording: String,
    idleUrl: String,
  ): RecordTileFace =
    if (live) {
      // The sport the snapshot last saw need not be the one recording, so the
      // tile names the app rather than a sport.
      RecordTileFace(Tile.STATE_ACTIVE, appName, recording, LIVE_URL)
    } else {
      RecordTileFace(
        Tile.STATE_INACTIVE,
        snap?.launcherShortcuts?.firstOrNull()?.label ?: appName,
        null,
        idleUrl,
      )
    }
}
