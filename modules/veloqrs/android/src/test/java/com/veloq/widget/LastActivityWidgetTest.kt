package com.veloq.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the Last activity widget leads with how the session compared: its rank among the
 * attempts at the route and the gap to the record, with every attempt as a dot. An activity on no
 * route leads with its load against the typical load instead.
 *
 * Expected behaviour: the matched fixture draws "2 of 14" and the gap with fourteen dots and no
 * load hero; the unmatched fixture draws the load as the hero, with no rank and no dots; the
 * smallest size drops the route and the name for the comparison, a placement one row tall keeps
 * only the comparison and its dots, the largest adds load and form before and after; a snapshot
 * without the engine's words falls back to the name and figures.
 */
class LastActivityWidgetTest {
  private fun dots(count: Int, record: Int, current: Int): JSONArray =
    JSONArray().apply {
      for (i in 0 until count) {
        put(JSONObject().put("current", i == current).put("record", i == record))
      }
    }

  private val matchedHeadline: JSONObject =
    JSONObject()
      .put("kind", "route")
      .put("label", "Lake loop")
      .put("hero", "2 of 14")
      .put("detail", "1:35 off your best")
      .put("dots", dots(14, record = 0, current = 13))

  private val loadHeadline: JSONObject =
    JSONObject()
      .put("kind", "load")
      .put("label", "Load")
      .put("hero", "62")
      .put("detail", "+24% vs your typical load")
      .put("dots", JSONArray())

  private fun latest(headline: JSONObject?): JSONObject =
    JSONObject()
      .put("activityId", "i1")
      .put("name", "Morning Ride")
      .put("distanceLabel", "42.1 km")
      .put("durationLabel", "1:34:20")
      .put("dateLabel", "Today")
      .put("tintHex", "#3B82F6")
      .put("isPr", false)
      .put("trainingLoad", 62)
      .put("loadText", "Load 62")
      .put("sectionPrsText", "Section PRs 3")
      .apply { headline?.let { put("headline", it) } }

  private val impact: JSONObject =
    JSONObject()
      .put("formBefore", 12.0)
      .put("formAfter", -4.0)
      .put("formBeforeText", "12")
      .put("formAfterText", "-4")
      .put("formBeforeZone", "optimal")
      .put("formAfterZone", "greyZone")

  private fun snapshot(headline: JSONObject?, withImpact: Boolean = true): WidgetSnapshot {
    val root =
      JSONObject()
        .put("emptyLibrary", false)
        .put("latest", latest(headline))
        .put("display", JSONObject().put("metricLabels", JSONObject().put("form", "Form")))
    if (withImpact) root.put("impact", impact)
    return WidgetSnapshot.parse(root)
  }

  private fun content(snap: WidgetSnapshot, size: SummarySize): LastActivityContent =
    LastActivityWidget.content(snap, size)!!

  @Test
  fun a_matched_activity_leads_with_its_rank_and_the_gap_with_every_attempt_as_a_dot() {
    val c = content(snapshot(matchedHeadline), SummarySize.MEDIUM)

    assertEquals("2 of 14", c.hero)
    assertEquals("Lake loop", c.heroLabel)
    assertEquals("1:35 off your best", c.detail)
    assertEquals(14, c.dots.size)
    assertTrue("the latest is the last dot", c.dots.last().current)
    assertEquals(listOf(0), c.dots.indices.filter { c.dots[it].record })
  }

  @Test
  fun an_unmatched_activity_leads_with_its_load_and_no_rank_or_dots() {
    for (size in SummarySize.values().filter { it != SummarySize.SHORT }) {
      val c = content(snapshot(loadHeadline), size)
      assertEquals("Load", c.heroLabel)
      assertEquals("62", c.hero)
      assertEquals("+24% vs your typical load", c.detail)
      assertTrue(c.dots.isEmpty())
      assertNull("the load is not drawn twice", c.load)
    }
  }

  @Test
  fun the_smallest_size_drops_the_route_and_the_name_for_the_comparison() {
    val c = content(snapshot(matchedHeadline), SummarySize.SMALL)

    assertFalse(c.showsRoute)
    assertNull(c.name)
    assertEquals("2 of 14", c.hero)
    assertEquals("Section PRs 3", c.sectionPrs)
    assertEquals("Today", c.date)
    assertNull(c.form)
  }

  @Test
  fun a_placement_one_row_tall_draws_only_the_comparison_and_its_dots() {
    val c = content(snapshot(matchedHeadline), SummarySize.SHORT)

    assertEquals("2 of 14", c.hero)
    assertEquals("1:35 off your best", c.detail)
    assertEquals(14, c.dots.size)
    assertNull("the route's name has no row to wrap into", c.heroLabel)
    assertNull(c.name)
    assertFalse(c.showsRoute)
    assertNull(c.sectionPrs)
    assertNull(c.date)
    assertNull(c.load)
    assertNull(c.form)
  }

  @Test
  fun the_middle_size_draws_the_route_and_the_name_beside_the_comparison() {
    val withRoute =
      JSONObject()
        .put("points", JSONArray(listOf(JSONArray(listOf(0.0, 0.0)), JSONArray(listOf(1.0, 1.0)))))
        .put("aspect", 1.0)
    val root =
      JSONObject()
        .put("emptyLibrary", false)
        .put("latest", latest(matchedHeadline).put("routePreview", withRoute))
    val c = content(WidgetSnapshot.parse(root), SummarySize.MEDIUM)

    assertTrue(c.showsRoute)
    assertEquals("Morning Ride", c.name)
    assertEquals("Section PRs 3", c.sectionPrs)
  }

  @Test
  fun an_activity_with_no_track_draws_no_route() {
    assertFalse(content(snapshot(matchedHeadline), SummarySize.MEDIUM).showsRoute)
  }

  @Test
  fun the_largest_size_adds_the_load_and_the_form_before_and_after_in_their_zones() {
    val c = content(snapshot(matchedHeadline), SummarySize.LARGE)

    assertEquals("Load 62", c.load)
    val form = c.form!!
    assertEquals("Form", form.label)
    assertEquals("12", form.before)
    assertEquals("-4", form.after)
    assertEquals("optimal", form.beforeZone)
    assertEquals("greyZone", form.afterZone)
  }

  @Test
  fun a_missing_impact_leaves_the_form_row_out_rather_than_drawing_zeros() {
    assertNull(content(snapshot(matchedHeadline, withImpact = false), SummarySize.LARGE).form)
  }

  @Test
  fun without_a_section_record_there_is_no_section_line() {
    val root =
      JSONObject()
        .put("emptyLibrary", false)
        .put("latest", latest(matchedHeadline).apply { remove("sectionPrsText") })
    assertNull(content(WidgetSnapshot.parse(root), SummarySize.LARGE).sectionPrs)
  }

  @Test
  fun a_snapshot_without_a_headline_falls_back_to_the_name_and_figures() {
    for (size in SummarySize.values()) {
      val c = content(snapshot(null), size)
      assertNull(c.hero)
      assertTrue(c.dots.isEmpty())
      assertEquals("Morning Ride", c.name)
      assertEquals("42.1 km · 1:34:20", c.figures)
    }
  }

  @Test
  fun a_headline_with_no_hero_text_is_not_a_headline() {
    val blank = JSONObject(matchedHeadline.toString()).put("hero", "")
    assertNull(content(snapshot(blank), SummarySize.MEDIUM).hero)
  }

  @Test
  fun a_snapshot_with_no_latest_activity_has_nothing_to_draw() {
    val empty = WidgetSnapshot.parse(JSONObject().put("emptyLibrary", false))
    for (size in SummarySize.values()) assertNull(LastActivityWidget.content(empty, size))
  }

  @Test
  fun this_activity_carries_the_reticle_and_the_record_its_gold_dot_combined_by_shape() {
    val earlier = AttemptMark.of(AttemptDot(current = false, record = false))
    val record = AttemptMark.of(AttemptDot(current = false, record = true))
    val current = AttemptMark.of(AttemptDot(current = true, record = false))
    val both = AttemptMark.of(AttemptDot(current = true, record = true))

    assertEquals(AttemptMark(AttemptFill.EARLIER, full = false, reticle = false), earlier)
    assertEquals(AttemptMark(AttemptFill.RECORD, full = true, reticle = false), record)
    assertEquals(AttemptMark(AttemptFill.EARLIER, full = true, reticle = true), current)
    assertEquals(AttemptMark(AttemptFill.RECORD, full = true, reticle = true), both)
  }

  @Test
  fun only_this_activity_is_marked_with_the_reticle_in_a_row_of_attempts() {
    val marks = content(snapshot(matchedHeadline), SummarySize.MEDIUM).dots.map(AttemptMark::of)
    assertEquals(listOf(13), marks.indices.filter { marks[it].reticle })
    assertEquals(listOf(0), marks.indices.filter { marks[it].fill == AttemptFill.RECORD })
  }

  @Test
  fun the_size_follows_the_width_and_then_the_height() {
    assertEquals(SummarySize.SMALL, LastActivityWidget.sizeFor(110, 110))
    assertEquals(SummarySize.SMALL, LastActivityWidget.sizeFor(150, 300))
    assertEquals(SummarySize.MEDIUM, LastActivityWidget.sizeFor(250, 110))
    assertEquals(SummarySize.MEDIUM, LastActivityWidget.sizeFor(250, 179))
    assertEquals(SummarySize.LARGE, LastActivityWidget.sizeFor(250, 180))
    assertEquals(SummarySize.SHORT, LastActivityWidget.sizeFor(130, 51))
    assertEquals(SummarySize.SHORT, LastActivityWidget.sizeFor(276, 51))
    assertEquals(SummarySize.SMALL, LastActivityWidget.sizeFor(0, 0))
  }
}
