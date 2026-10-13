package com.veloq.widget

import android.service.quicksettings.Tile
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: the rider pulls down Quick Settings, once with a ride recording and
 * once with none, after recording a walk most recently.
 *
 * Expected behaviour: a live ride lights the tile, says it is recording and
 * opens the record entry, which shows the ride already live. With no ride the
 * tile stays an idle shortcut that starts the most recent sport.
 */
class RecordTileTest {
  @Test
  fun a_live_ride_lights_the_tile_and_opens_the_record_entry() {
    val face = RecordTile.face(true, snapshot(), APP, RECORDING, WALK_URL)

    assertEquals(Tile.STATE_ACTIVE, face.state)
    assertEquals(RECORDING, face.subtitle)
    assertEquals("veloq://record", face.url)
    assertEquals(APP, face.label)
  }

  @Test
  fun a_live_ride_lights_the_tile_before_any_snapshot_is_written() {
    val face = RecordTile.face(true, null, APP, RECORDING, "veloq://record")

    assertEquals(Tile.STATE_ACTIVE, face.state)
    assertEquals(RECORDING, face.subtitle)
    assertEquals("veloq://record", face.url)
  }

  @Test
  fun no_ride_leaves_an_idle_shortcut_to_the_last_sport() {
    val face = RecordTile.face(false, snapshot(), APP, RECORDING, WALK_URL)

    assertEquals(Tile.STATE_INACTIVE, face.state)
    assertNull(face.subtitle)
    assertEquals(WALK_URL, face.url)
    assertEquals("Walk", face.label)
  }

  @Test
  fun no_ride_and_no_snapshot_names_the_app() {
    val face = RecordTile.face(false, null, APP, RECORDING, "veloq://record")

    assertEquals(Tile.STATE_INACTIVE, face.state)
    assertNull(face.subtitle)
    assertEquals(APP, face.label)
  }

  private fun snapshot(): WidgetSnapshot =
    WidgetSnapshot.parse(
      JSONObject()
        .put(
          "launcherShortcuts",
          JSONArray().put(JSONObject().put("type", "Walk").put("label", "Walk").put("url", WALK_URL)),
        )
    )

  private companion object {
    const val APP = "Trailbook"
    const val RECORDING = "Recording"
    const val WALK_URL = "veloq://record/Walk"
  }
}
