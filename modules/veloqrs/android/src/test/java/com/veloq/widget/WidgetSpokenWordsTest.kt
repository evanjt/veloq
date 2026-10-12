package com.veloq.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: a screen reader reaches a widget. The arrow beside a metric carries its verdict in
 * colour, the charts, the route and the body are bitmaps, and an insight's tone is a coloured
 * dot, so the renderer has nothing to say for any of them unless the snapshot carries the words.
 *
 * Expected behaviour: every word the engine composed for them is read off the snapshot, a body
 * the window does not draw says nothing, and a snapshot written before the words still gives a
 * metric cell its label and value.
 */
class WidgetSpokenWordsTest {
  private fun metric(spoken: String?): JSONObject =
    JSONObject().put("value", 52.0).put("trendDir", "up").put("verdict", "improved").apply {
      spoken?.let { put("spoken", it) }
    }

  private fun window(bodyLabel: String?, emptyText: String? = null): JSONObject =
    JSONObject()
      .put("label", "Last 30 days")
      .put("muscles", JSONArray().put(JSONObject().put("slug", "glutes").put("shade", 3)))
      .put("top", JSONArray())
      .apply {
        bodyLabel?.let { put("bodyLabel", it) }
        emptyText?.let { put("emptyText", it) }
      }

  private fun snapshot(): WidgetSnapshot =
    WidgetSnapshot.parse(
      JSONObject()
        .put("emptyLibrary", false)
        .put("metrics", JSONObject().put("fitness", metric("Fitness 52, improved")))
        .put(
          "summaryMetrics",
          JSONArray()
            .put(
              JSONObject()
                .put("id", "fitness")
                .put("label", "Fitness")
                .put("value", "52")
                .put("spoken", "Fitness 52, improved"))
            .put(JSONObject().put("id", "ftp").put("label", "FTP").put("value", "251")),
        )
        .put(
          "display",
          JSONObject()
            .put(
              "chartLabels",
              JSONObject()
                .put("fitness", "Fitness 40 to 52 over 30 days")
                .put("form", "Form -10 to -8 over 42 days, now Grey Zone")))
        .put(
          "latest",
          JSONObject()
            .put("name", "Harbour Loop")
            .put("isPr", true)
            .put("routeLabel", "Route map of Harbour Loop")
            .put("prLabel", "Personal record"))
        .put(
          "insights",
          JSONArray()
            .put(
              JSONObject()
                .put("title", "New record")
                .put("tone", "record")
                .put("url", "veloq://section/s1")
                .put("toneLabel", "Record")))
        .put(
          "strength",
          JSONObject()
            .put("body", "male")
            .put("url", "veloq://strength")
            .put(
              "windows",
              JSONObject()
                .put("last30", window("Most trained: Glutes 7 sets"))
                .put("month", window("Most trained: Glutes 2 sets", "No strength work")))))

  @Test
  fun the_verdict_a_colour_carries_is_read_as_words() {
    val snap = snapshot()
    assertEquals("Fitness 52, improved", snap.fitness.spoken)
    assertEquals("Fitness 52, improved", snap.summaryMetrics[0].spokenOrPlain())
  }

  @Test
  fun a_cell_from_a_snapshot_before_the_words_says_its_label_and_value() {
    assertEquals("FTP 251", snapshot().summaryMetrics[1].spokenOrPlain())
  }

  @Test
  fun each_chart_the_route_the_record_and_the_tone_carry_their_words() {
    val snap = snapshot()
    assertEquals("Fitness 40 to 52 over 30 days", snap.chartLabels.fitness)
    assertNull(snap.chartLabels.hrv)
    assertEquals("Form -10 to -8 over 42 days, now Grey Zone", snap.chartLabels.form)
    assertEquals("Route map of Harbour Loop", snap.latest?.routeLabel)
    assertEquals("Personal record", snap.latest?.prLabel)
    assertEquals("Record", snap.insights.single().toneLabel)
  }

  @Test
  fun the_body_says_what_it_shows_and_a_window_drawing_words_instead_says_nothing() {
    val snap = snapshot()
    assertEquals(
      "Most trained: Glutes 7 sets",
      StrengthWidget.content(snap, SummarySize.MEDIUM, StrengthWidget.LAST30)?.bodyLabel)
    assertNull(StrengthWidget.content(snap, SummarySize.MEDIUM, StrengthWidget.MONTH)?.bodyLabel)
  }
}
