package com.veloq.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: a Summary value is primary text, and the measure it belongs to is said by a dot
 * beside it in that measure's colour.
 *
 * Expected behaviour: fitness and fatigue take their series and form takes the zone it sits in.
 * An entry with no measure colour, form with no zone, and a zone this build does not know draw
 * no dot rather than a guessed colour.
 */
class SummaryKeyDotTest {
  @Test
  fun fitness_and_fatigue_take_their_series() {
    assertEquals("blue", SummaryWidget.keyTone("blue", null))
    assertEquals("fatigue", SummaryWidget.keyTone("fatigue", "optimal"))
  }

  @Test
  fun form_takes_its_zone() {
    for (zone in listOf("highRisk", "optimal", "greyZone", "fresh", "transition")) {
      assertEquals(zone, SummaryWidget.keyTone("formZone", zone))
    }
  }

  @Test
  fun no_measure_colour_draws_no_dot() {
    assertNull(SummaryWidget.keyTone("default", "optimal"))
    assertNull(SummaryWidget.keyTone("formZone", null))
    assertNull(SummaryWidget.keyTone("formZone", "sideways"))
  }
}
