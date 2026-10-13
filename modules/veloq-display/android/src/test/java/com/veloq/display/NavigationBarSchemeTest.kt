package com.veloq.display

import android.content.res.Configuration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the app's own scheme preference differs from the system's, and the activity handles
 * `uiMode` itself, so it is never recreated when the preference is applied.
 *
 * Expected behaviour: every configuration the activity sees decides the navigation bar again, so a
 * dark configuration gives light icons on a dark bar and a light one the reverse, on each change.
 */
class NavigationBarSchemeTest {
  private val dark = Configuration.UI_MODE_TYPE_NORMAL or Configuration.UI_MODE_NIGHT_YES
  private val light = Configuration.UI_MODE_TYPE_NORMAL or Configuration.UI_MODE_NIGHT_NO
  private val undefined = Configuration.UI_MODE_TYPE_NORMAL or Configuration.UI_MODE_NIGHT_UNDEFINED

  @Test
  fun a_dark_configuration_asks_for_no_light_icons() {
    assertFalse(NavigationBarScheme.appearance(dark, sdk = 34).lightIcons)
  }

  @Test
  fun a_light_configuration_asks_for_light_icons() {
    assertTrue(NavigationBarScheme.appearance(light, sdk = 34).lightIcons)
  }

  @Test
  fun an_undefined_night_bit_reads_as_light() {
    assertTrue(NavigationBarScheme.appearance(undefined, sdk = 34).lightIcons)
  }

  @Test
  fun each_change_decides_the_bar_again() {
    val changes = listOf(light, dark, light).map { NavigationBarScheme.appearance(it, sdk = 34) }
    assertEquals(listOf(true, false, true), changes.map { it.lightIcons })
  }

  @Test
  fun from_api_29_the_bar_colour_is_left_transparent() {
    assertNull(NavigationBarScheme.appearance(dark, sdk = 29).color)
    assertNull(NavigationBarScheme.appearance(light, sdk = 34).color)
  }

  @Test
  fun on_api_28_a_dark_configuration_gives_the_dark_bar() {
    assertEquals(NavigationBarScheme.DARK_BAR, NavigationBarScheme.appearance(dark, sdk = 28).color)
  }

  @Test
  fun on_api_26_a_light_configuration_gives_the_light_bar() {
    val appearance = NavigationBarScheme.appearance(light, sdk = 26)
    assertEquals(NavigationBarScheme.LIGHT_BAR, appearance.color)
    assertTrue(appearance.lightIcons)
  }

  @Test
  fun below_api_26_the_bar_stays_dark_with_light_icons_unavailable() {
    val appearance = NavigationBarScheme.appearance(light, sdk = 25)
    assertEquals(NavigationBarScheme.DARK_BAR, appearance.color)
    assertFalse(appearance.lightIcons)
  }

  @Test
  fun the_bar_colours_are_the_platform_scrims() {
    assertEquals(0xE6FFFFFF.toInt(), NavigationBarScheme.LIGHT_BAR)
    assertEquals(0x801B1B1B.toInt(), NavigationBarScheme.DARK_BAR)
  }
}
