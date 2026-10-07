package com.veloq.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the widget sources the app ships are compiled here unchanged, apart
 * from the package placeholder, so these tests run the production decisions.
 *
 * Expected behaviour: the Quick Settings tile hands over a PendingIntent from
 * API 34 and an Intent below it, and the snapshot keeps the full record list
 * the widget picker reads apart from the shorter launcher list.
 */
class WidgetLaunchTest {
  @Test
  fun the_tile_takes_an_intent_below_api_34() {
    for (sdk in listOf(26, 29, 31, 33)) {
      assertFalse("sdk $sdk", TileLaunch.takesPendingIntent(sdk))
    }
  }

  @Test
  fun the_tile_takes_a_pending_intent_from_api_34() {
    for (sdk in listOf(34, 35, 36)) {
      assertTrue("sdk $sdk", TileLaunch.takesPendingIntent(sdk))
    }
  }

  @Test
  fun the_picker_list_and_the_launcher_list_stay_distinct() {
    val snapshot =
      WidgetSnapshot.parse(
        JSONObject()
          .put("recordShortcuts", shortcuts("Swim", "Walk", "Run", "Ride"))
          .put("launcherShortcuts", shortcuts("Swim", "Walk", "Run"))
      )

    assertEquals(listOf("Swim", "Walk", "Run", "Ride"), snapshot.recordShortcuts.map { it.type })
    assertEquals(listOf("Swim", "Walk", "Run"), snapshot.launcherShortcuts.map { it.type })
  }

  @Test
  fun a_shortcut_without_a_url_or_type_is_dropped() {
    val snapshot =
      WidgetSnapshot.parse(
        JSONObject()
          .put(
            "recordShortcuts",
            JSONArray()
              .put(JSONObject().put("type", "Swim").put("label", "Swim"))
              .put(JSONObject().put("url", "veloq://record/Run"))
              .put(entry("Ride"))
          )
      )

    assertEquals(listOf("Ride"), snapshot.recordShortcuts.map { it.type })
    assertTrue(snapshot.launcherShortcuts.isEmpty())
  }

  private fun shortcuts(vararg types: String): JSONArray {
    val arr = JSONArray()
    for (t in types) arr.put(entry(t))
    return arr
  }

  private fun entry(type: String): JSONObject =
    JSONObject().put("type", type).put("label", type).put("url", "veloq://record/$type")
}
