package com.veloq.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: a library with activities and no wellness row yet sends a dash for every wellness
 * metric, and an empty library sends no metrics worth printing.
 *
 * Expected behaviour: the empty prompt replaces the metrics, a metric with no reading prints the
 * dash and no digit, and a measured metric prints its rounded number.
 */
class WidgetMetricTextTest {
  private fun metric(value: Double, text: String? = null): JSONObject =
    JSONObject().put("value", value).put("trendDir", "flat").apply { text?.let { put("text", it) } }

  private fun snapshot(empty: Boolean, metrics: JSONObject): WidgetSnapshot =
    WidgetSnapshot.parse(JSONObject().put("emptyLibrary", empty).put("metrics", metrics))

  @Test
  fun an_empty_library_and_a_missing_snapshot_show_the_prompt() {
    assertTrue(WidgetSnapshot.showsEmptyPrompt(null))
    assertTrue(WidgetSnapshot.showsEmptyPrompt(snapshot(true, JSONObject())))
  }

  @Test
  fun a_library_with_activities_shows_the_metrics() {
    assertFalse(WidgetSnapshot.showsEmptyPrompt(snapshot(false, JSONObject())))
  }

  @Test
  fun absent_wellness_prints_a_dash_for_every_metric_and_no_digit() {
    val s =
      snapshot(
        false,
        JSONObject()
          .put("fitness", metric(0.0, "-"))
          .put("fatigue", metric(0.0, "-"))
          .put("hrv", metric(0.0, "-"))
          .put("rhr", metric(0.0, "-"))
          .put("form", metric(0.0, "-"))
      )
    for (m in listOf(s.fitness, s.fatigue, s.hrv, s.rhr, s.form)) {
      assertEquals("-", m?.display())
    }
  }

  @Test
  fun a_measured_metric_prints_its_rounded_number() {
    val s = snapshot(false, JSONObject().put("fatigue", metric(41.6)).put("fitness", metric(0.4)))
    assertEquals("42", s.fatigue?.display())
    assertEquals("0", s.fitness?.display())
  }
}

/**
 * Scenario: the small activity widget has one line for the figures, and a relative date such as
 * "Yesterday" was cut to "Ye..." in what they left.
 *
 * Expected behaviour: the date sits on its own line, and an empty part leaves no stray separator.
 */
class LatestSubtitleTest {
  private fun latest(distance: String, duration: String, date: String) =
    Latest(null, "Night Ride", distance, duration, date, "", false, null, null)

  @Test
  fun the_date_takes_its_own_line() {
    assertEquals("526 m · 0:57\nYesterday", latest("526 m", "0:57", "Yesterday").subtitle())
  }

  @Test
  fun an_empty_part_leaves_no_separator() {
    assertEquals("0:57", latest("", "0:57", "").subtitle())
    assertEquals("Yesterday", latest("", "", "Yesterday").subtitle())
  }
}
