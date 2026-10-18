package com.veloq.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: a tinted Home Screen or a reader who cannot tell the two hues apart sees the fitness
 * and fatigue lines without their colours, and the legend under the chart draws fatigue dashed.
 *
 * Expected behaviour: fatigue is dashed by the theme's lengths at the display's density, as the
 * legend mark is, and fitness is solid.
 */
class ChartStrokeTest {
  @Test
  fun fatigue_is_dashed_by_the_theme_lengths_at_the_density() {
    val stroke = ChartStroke.fatigue(3f, listOf(3f, 2f))
    assertEquals(listOf(9f, 6f), stroke.dash)
    assertEquals(3f, stroke.width, 0.001f)
  }

  @Test
  fun fitness_is_solid() {
    val stroke = ChartStroke.solid(2f)
    assertNull(stroke.dash)
    assertEquals(3f, stroke.width, 0.001f)
  }

  @Test
  fun a_dash_with_no_lengths_draws_solid() {
    assertNull(ChartStroke.fatigue(2f, emptyList()).dash)
  }
}
