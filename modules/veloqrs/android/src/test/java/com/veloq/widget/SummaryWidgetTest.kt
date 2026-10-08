package com.veloq.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the Summary widget draws the app's summary card at three sizes, and a placed widget
 * may be configured with a hero of its own.
 *
 * Expected behaviour: the supporting row lists the card's entries in the card's order, Small
 * shows none, a widget following the card draws exactly what the snapshot carries, a chosen hero
 * moves the card's own hero into the row rather than losing it, and a snapshot with no card
 * draws the metrics every snapshot has.
 */
class SummaryWidgetTest {
  private fun entry(id: String, label: String, value: String = "1"): JSONObject =
    JSONObject()
      .put("id", id)
      .put("label", label)
      .put("value", value)
      .put("trendDir", "up")
      .put("verdict", "improved")
      .put("colorKey", "default")

  private fun metric(value: Double, zone: String? = null): JSONObject =
    JSONObject().put("value", value).put("trendDir", "down").put("verdict", "declined").apply {
      zone?.let { put("zone", it) }
    }

  private fun card(hero: String, vararg supporting: Pair<String, String>, sparkline: String = "fitnessForm"): JSONObject =
    JSONObject()
      .put("hero", entry(hero, hero.uppercase()))
      .put("entries", JSONArray().apply { supporting.forEach { put(entry(it.first, it.second)) } })
      .put("sparkline", sparkline)
      .put("heroSparkline", JSONArray(listOf(1, 2, 3)))

  private fun snapshot(card: JSONObject?, extra: JSONObject.() -> Unit = {}): WidgetSnapshot {
    val root =
      JSONObject()
        .put("emptyLibrary", false)
        .put(
          "metrics",
          JSONObject()
            .put("form", metric(-12.0, "greyZone"))
            .put("fitness", metric(60.0))
            .put("fatigue", metric(72.0))
            .put("hrv", metric(48.0))
            .put("rhr", metric(51.0)),
        )
        .put(
          "display",
          JSONObject()
            .put("formZone", "Grey zone")
            .put(
              "metricLabels",
              JSONObject()
                .put("form", "Form")
                .put("fitness", "Fitness")
                .put("fatigue", "Fatigue")
                .put("hrv", "HRV")
                .put("rhr", "RHR"),
            ),
        )
        .put(
          "sparklines",
          JSONObject()
            .put("fitness", JSONArray(listOf(50, 52, 55)))
            .put("fatigue", JSONArray(listOf(60, 66, 70)))
            .put("hrv", JSONArray(listOf(44, 46, 48)))
            .put("form", JSONArray(listOf(-10, -14, -12))),
        )
    card?.let { root.put("summaryCard", it) }
    root.extra()
    return WidgetSnapshot.parse(root)
  }

  private val ftpCard =
    card(
      "fitness",
      "hrv" to "HRV",
      "rhr" to "RHR",
      "weekHours" to "Week",
      "ftp" to "FTP",
    )

  @Test
  fun the_size_follows_the_cells_the_host_reports() {
    assertEquals(SummarySize.SMALL, SummaryWidget.sizeFor(110, 110))
    assertEquals(SummarySize.SMALL, SummaryWidget.sizeFor(199, 400))
    assertEquals(SummarySize.MEDIUM, SummaryWidget.sizeFor(250, 110))
    assertEquals(SummarySize.MEDIUM, SummaryWidget.sizeFor(250, 199))
    assertEquals(SummarySize.LARGE, SummaryWidget.sizeFor(250, 200))
    assertEquals(SummarySize.SMALL, SummaryWidget.sizeFor(0, 0))
  }

  @Test
  fun a_placement_one_row_tall_is_short_at_any_width() {
    assertEquals(SummarySize.SHORT, SummaryWidget.sizeFor(130, 51))
    assertEquals(SummarySize.SHORT, SummaryWidget.sizeFor(276, 51))
    assertEquals(SummarySize.SHORT, SummaryWidget.sizeFor(276, 99))
    assertEquals(SummarySize.MEDIUM, SummaryWidget.sizeFor(276, 100))
    assertEquals(SummarySize.SMALL, SummaryWidget.sizeFor(130, 117))
  }

  @Test
  fun short_shows_the_hero_and_no_supporting_entry() {
    val c = card("form", "fitness" to "Fitness", "fatigue" to "Fatigue")
    assertTrue(SummaryWidget.supporting(SummaryWidget.card(snapshot(c), null), SummarySize.SHORT).isEmpty())
  }

  @Test
  fun medium_and_large_list_the_cards_four_labels_in_order() {
    val snap = snapshot(ftpCard)
    val drawn = SummaryWidget.card(snap, null)
    for (size in listOf(SummarySize.MEDIUM, SummarySize.LARGE)) {
      assertEquals(
        listOf("HRV", "RHR", "Week", "FTP"),
        SummaryWidget.supporting(drawn, size).map { it.label },
      )
    }
    assertEquals("FITNESS", drawn.hero.label)
  }

  @Test
  fun small_shows_the_hero_and_no_supporting_entry() {
    val drawn = SummaryWidget.card(snapshot(ftpCard), null)
    assertTrue(SummaryWidget.supporting(drawn, SummarySize.SMALL).isEmpty())
  }

  @Test
  fun a_card_with_fewer_than_four_entries_shows_only_those() {
    val snap = snapshot(card("fitness", "hrv" to "HRV", "rhr" to "RHR"))
    val drawn = SummaryWidget.card(snap, null)
    assertEquals(listOf("HRV", "RHR"), SummaryWidget.supporting(drawn, SummarySize.MEDIUM).map { it.label })
  }

  @Test
  fun following_the_card_and_an_unknown_choice_draw_the_snapshots_card() {
    val snap = snapshot(ftpCard)
    for (choice in listOf(null, SummaryWidget.FOLLOW_CARD, "weekHours", "")) {
      assertEquals("choice $choice", snap.summaryCard, SummaryWidget.card(snap, choice))
    }
  }

  @Test
  fun a_chosen_hero_takes_the_snapshots_reading_and_labels() {
    val snap = snapshot(ftpCard)
    val drawn = SummaryWidget.card(snap, "form")
    assertEquals("form", drawn.hero.id)
    assertEquals("Form", drawn.hero.label)
    assertEquals("-12", drawn.hero.value)
    assertEquals("down", drawn.hero.trendDir)
    assertEquals("declined", drawn.hero.verdict)
    assertEquals("formZone", drawn.hero.colorKey)
  }

  @Test
  fun a_chosen_hero_moves_the_cards_hero_into_the_row_and_never_repeats_itself() {
    val snap = snapshot(ftpCard)
    val drawn = SummaryWidget.card(snap, "hrv")
    assertEquals("HRV", drawn.hero.label)
    assertEquals(
      listOf("FITNESS", "RHR", "Week", "FTP"),
      SummaryWidget.supporting(drawn, SummarySize.LARGE).map { it.label },
    )
  }

  @Test
  fun a_chosen_hero_the_card_already_leads_with_changes_nothing() {
    val snap = snapshot(ftpCard)
    assertEquals(snap.summaryCard, SummaryWidget.card(snap, "fitness"))
  }

  @Test
  fun only_an_hrv_hero_draws_the_hrv_line() {
    val snap = snapshot(ftpCard)
    assertEquals("hrv", SummaryWidget.card(snap, "hrv").sparkline)
    assertEquals("fitnessForm", SummaryWidget.card(snap, "rhr").sparkline)
  }

  @Test
  fun a_card_that_hides_its_sparkline_keeps_it_hidden_under_a_chosen_hero() {
    val snap = snapshot(card("fitness", "hrv" to "HRV", sparkline = "none"))
    assertEquals("none", SummaryWidget.card(snap, "form").sparkline)
    assertEquals(SummaryChart.None, SummaryWidget.chart(snap, SummaryWidget.card(snap, "form")))
  }

  @Test
  fun a_snapshot_with_no_card_draws_form_over_the_metrics_every_snapshot_has() {
    val snap = snapshot(null)
    val drawn = SummaryWidget.card(snap, null)
    assertEquals("Form", drawn.hero.label)
    assertEquals(
      listOf("Fitness", "Fatigue", "HRV", "RHR"),
      SummaryWidget.supporting(drawn, SummarySize.MEDIUM).map { it.label },
    )
  }

  @Test
  fun the_fitness_chart_draws_both_series_and_the_hrv_chart_its_own() {
    val snap = snapshot(ftpCard)
    val fitness = SummaryWidget.chart(snap, SummaryWidget.card(snap, null))
    assertEquals(SummaryChart.Dual(listOf(50f, 52f, 55f), listOf(60f, 66f, 70f)), fitness)

    val chosen = SummaryWidget.chart(snap, SummaryWidget.card(snap, "hrv"))
    assertEquals(SummaryChart.Single(listOf(44f, 46f, 48f)), chosen)

    val hrvCard = snapshot(card("hrv", "rhr" to "RHR", sparkline = "hrv"))
    assertEquals(
      SummaryChart.Single(listOf(1f, 2f, 3f)),
      SummaryWidget.chart(hrvCard, SummaryWidget.card(hrvCard, null)),
    )
  }

  @Test
  fun a_series_of_one_point_draws_no_chart() {
    val snap = snapshot(ftpCard) {
      put("sparklines", JSONObject().put("fitness", JSONArray(listOf(50))).put("fatigue", JSONArray(listOf(60))))
    }
    assertEquals(SummaryChart.None, SummaryWidget.chart(snap, SummaryWidget.card(snap, null)))
  }

  @Test
  fun the_form_hero_carries_its_zone_and_no_other_hero_does() {
    val snap = snapshot(ftpCard)
    assertEquals("Grey zone", SummaryWidget.heroLine(snap, SummaryWidget.card(snap, "form")))
    assertNull(SummaryWidget.heroLine(snap, SummaryWidget.card(snap, null)))
  }

  @Test
  fun the_snapshot_keeps_form_days_with_no_value_as_gaps() {
    val snap =
      snapshot(ftpCard) {
        put(
          "formHistory",
          JSONObject()
            .put("values", JSONArray("[-12, null, 3]"))
            .put("asPercent", true)
            .put("zoneBounds", JSONArray(listOf(-30, -10, 5, 25))),
        )
      }
    val history = snap.formHistory
    assertNotNull(history)
    assertEquals(listOf(-12f, null, 3f), history!!.values)
    assertEquals(listOf(-30, -10, 5, 25), history.zoneBounds)
    assertTrue(history.asPercent)
  }

  @Test
  fun a_snapshot_before_the_form_history_has_none() {
    assertNull(snapshot(ftpCard).formHistory)
    assertNull(SummaryWidget.formZones(snapshot(ftpCard)))
  }

  @Test
  fun the_form_chart_bands_run_from_high_risk_up_to_transition_and_hold_every_value() {
    val snap =
      snapshot(ftpCard) {
        put(
          "formHistory",
          JSONObject()
            .put("values", JSONArray("[-45, -12, null, 3, 40]"))
            .put("asPercent", false)
            .put("zoneBounds", JSONArray(listOf(-30, -10, 5, 25))),
        )
      }
    val chart = SummaryWidget.formZones(snap)!!
    assertEquals(
      listOf("highRisk", "optimal", "greyZone", "fresh", "transition"),
      chart.bands.map { it.zone },
    )
    assertEquals(listOf(-30f, -10f, 5f, 25f), chart.bands.dropLast(1).map { it.to })
    assertEquals(chart.min, chart.bands.first().from)
    assertEquals(chart.max, chart.bands.last().to)
    assertTrue(chart.min <= -45f && chart.max >= 40f)
    assertEquals(listOf(-45f, -12f, null, 3f, 40f), chart.values)
  }

  @Test
  fun the_form_chart_keeps_every_zone_in_view_when_the_values_sit_in_one() {
    val snap =
      snapshot(ftpCard) {
        put(
          "formHistory",
          JSONObject()
            .put("values", JSONArray("[0, 1, 2]"))
            .put("asPercent", false)
            .put("zoneBounds", JSONArray(listOf(-30, -10, 5, 25))),
        )
      }
    val chart = SummaryWidget.formZones(snap)!!
    assertTrue(chart.min < -30f && chart.max > 25f)
  }

  @Test
  fun a_form_history_with_fewer_than_two_values_draws_no_chart() {
    val snap =
      snapshot(ftpCard) {
        put(
          "formHistory",
          JSONObject()
            .put("values", JSONArray("[null, 4, null]"))
            .put("asPercent", false)
            .put("zoneBounds", JSONArray(listOf(-30, -10, 5, 25))),
        )
      }
    assertNull(SummaryWidget.formZones(snap))
  }

  @Test
  fun a_form_history_with_the_wrong_number_of_bounds_draws_no_chart() {
    val snap =
      snapshot(ftpCard) {
        put(
          "formHistory",
          JSONObject()
            .put("values", JSONArray("[1, 2, 3]"))
            .put("asPercent", false)
            .put("zoneBounds", JSONArray(listOf(-30, -10))),
        )
      }
    assertNull(snap.formHistory)
  }
}
