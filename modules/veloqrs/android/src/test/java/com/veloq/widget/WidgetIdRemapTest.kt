package com.veloq.widget

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Scenario: a launcher restores placed widgets onto a new phone under new ids, and each widget's
 * choice is stored under its old id.
 *
 * Expected behaviour: every choice follows its widget to the new id, no choice stays under an old
 * id, and a new id that equals some other widget's old id carries that new widget's choice only.
 */
class WidgetIdRemapTest {
  private val record = listOf("sport_url_")

  @Test
  fun choicesFollowTheirWidgetsWhenOldAndNewIdsOverlap() {
    val values = mapOf("sport_url_5" to "swim", "sport_url_12" to "ride")

    val remapped = WidgetIdRemap.remap(values, record, intArrayOf(5, 12), intArrayOf(12, 30))

    assertEquals(mapOf("sport_url_12" to "swim", "sport_url_30" to "ride"), remapped)
  }

  @Test
  fun aWidgetWithNoChoiceLeavesNoneUnderItsNewId() {
    val values = mapOf("sport_url_5" to "ride", "sport_url_9" to "walk")

    val remapped = WidgetIdRemap.remap(values, record, intArrayOf(5, 8), intArrayOf(8, 9))

    assertEquals(mapOf("sport_url_8" to "ride"), remapped)
  }

  @Test
  fun everyKeyOfAWidgetMovesAndUnrelatedKeysStay() {
    val summary = listOf("hero_", "sparkline_", "supporting_")
    val values =
      mapOf(
        "hero_3" to "fitness",
        "sparkline_3" to "off",
        "supporting_3" to "form,load",
        "hero_4" to "form",
        "hero_31" to "load",
        "unrelated" to "kept",
      )

    val remapped = WidgetIdRemap.remap(values, summary, intArrayOf(3), intArrayOf(40))

    assertEquals(
      mapOf(
        "hero_40" to "fitness",
        "sparkline_40" to "off",
        "supporting_40" to "form,load",
        "hero_4" to "form",
        "hero_31" to "load",
        "unrelated" to "kept",
      ),
      remapped,
    )
  }

  @Test
  fun aSetValueMovesWhole() {
    val values = mapOf("kinds_2" to setOf("pr", "streak"))

    val remapped = WidgetIdRemap.remap(values, listOf("kinds_"), intArrayOf(2), intArrayOf(7))

    assertEquals(mapOf("kinds_7" to setOf("pr", "streak")), remapped)
  }

  @Test
  fun noIdsChangeNothing() {
    val values = mapOf("window_1" to "month")

    assertEquals(values, WidgetIdRemap.remap(values, listOf("window_"), intArrayOf(), intArrayOf()))
  }
}
