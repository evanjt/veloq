package com.veloq.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: a 120 Hz panel offers 60 and 120 Hz at its native resolution and the same rates at a
 * lower one, and Android starts the window at 60.
 *
 * Expected behaviour: the window asks for the fastest mode at the resolution it already has, never
 * a mode that would switch the panel's resolution, and asks for nothing when it is already there.
 */
class RefreshRateTest {
  private val native60 = DisplayModeSpec(id = 1, width = 1080, height = 2340, refreshRate = 60f)
  private val native120 = DisplayModeSpec(id = 2, width = 1080, height = 2340, refreshRate = 120f)
  private val low60 = DisplayModeSpec(id = 3, width = 720, height = 1560, refreshRate = 60f)
  private val low144 = DisplayModeSpec(id = 4, width = 720, height = 1560, refreshRate = 144f)

  @Test
  fun a_window_at_60_asks_for_120_at_the_same_resolution() {
    assertEquals(2, RefreshRate.preferredModeId(native60, listOf(native60, native120, low60, low144)))
  }

  @Test
  fun a_faster_mode_at_another_resolution_is_never_chosen() {
    assertEquals(2, RefreshRate.preferredModeId(native60, listOf(low144, native60, native120)))
  }

  @Test
  fun a_window_already_at_the_fastest_mode_asks_for_nothing() {
    assertNull(RefreshRate.preferredModeId(native120, listOf(native60, native120, low144)))
  }

  @Test
  fun a_panel_with_one_mode_asks_for_nothing() {
    assertNull(RefreshRate.preferredModeId(native60, listOf(native60)))
  }

  @Test
  fun no_supported_modes_asks_for_nothing() {
    assertNull(RefreshRate.preferredModeId(native60, emptyList()))
  }
}
