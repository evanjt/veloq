package com.veloq.widget

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Scenario: a long press on the launcher icon lists the athlete's recent sports.
 *
 * Expected behaviour: each sport family draws its own glyph, so a ride, a run and a
 * swim differ by more than their label, and a key this build does not know draws the
 * catch-all rather than nothing.
 */
class RecordShortcutIconsTest {
  private val families = listOf("ride", "winter", "run", "water", "foot", "strength", "other")

  @Test
  fun every_family_draws_its_own_glyph() {
    val glyphs = families.map { RecordShortcutIcons.glyph(it) }
    assertEquals(families.size, glyphs.toSet().size)
  }

  @Test
  fun the_three_launcher_sports_of_a_triathlete_differ() {
    assertEquals(
      3,
      setOf(
        RecordShortcutIcons.glyph("ride"),
        RecordShortcutIcons.glyph("run"),
        RecordShortcutIcons.glyph("water"),
      ).size,
    )
  }

  @Test
  fun an_unknown_or_missing_key_draws_the_catch_all() {
    val other = RecordShortcutIcons.glyph("other")
    assertEquals(other, RecordShortcutIcons.glyph("underwater-basket"))
    assertEquals(other, RecordShortcutIcons.glyph(""))
    assertEquals(other, RecordShortcutIcons.glyph(null))
  }
}
