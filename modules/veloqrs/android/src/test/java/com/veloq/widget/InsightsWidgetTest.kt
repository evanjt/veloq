package com.veloq.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the Insights widget lists the Insights tab's ranked cards, one at the smallest size,
 * two at the next and four at the largest, and a placed widget may be limited to some kinds.
 *
 * Expected behaviour: each size draws that many rows in the tab's order, each row opens its own
 * link, the largest size counts the rows it has no room for, a kind pick removes the other kinds
 * before the rows are counted, and an empty or unreadable pick lists every kind.
 */
class InsightsWidgetTest {
  private fun insight(id: String, category: String, url: String = "veloq://insights"): JSONObject =
    JSONObject()
      .put("id", id)
      .put("category", category)
      .put("title", "title $id")
      .put("subtitle", "subtitle $id")
      .put("icon", "trending-up")
      .put("tone", "positive")
      .put("url", url)

  private val ranked =
    listOf(
      insight("a", "section_pr", "veloq://section/s1"),
      insight("b", "hrv_trend", "veloq://fitness?range=3m"),
      insight("c", "route", "veloq://route/r1"),
      insight("d", "period_comparison"),
      insight("e", "stale_pr", "veloq://section/s2"),
    )

  private fun snapshot(insights: List<JSONObject>? = ranked): WidgetSnapshot {
    val root = JSONObject().put("emptyLibrary", false)
    insights?.let { root.put("insights", JSONArray(it)) }
    return WidgetSnapshot.parse(root)
  }

  private fun ids(size: SummarySize, kinds: Set<String>? = null, snap: WidgetSnapshot = snapshot()) =
    InsightsWidget.content(snap, size, kinds).rows.map { it.id }

  @Test
  fun the_three_sizes_list_one_two_and_four_rows_of_five_insights() {
    assertEquals(listOf("a"), ids(SummarySize.SMALL))
    assertEquals(listOf("a", "b"), ids(SummarySize.MEDIUM))
    assertEquals(listOf("a", "b", "c", "d"), ids(SummarySize.LARGE))
  }

  @Test
  fun each_row_opens_its_own_target() {
    val rows = InsightsWidget.content(snapshot(), SummarySize.LARGE, null).rows
    assertEquals(
      listOf("veloq://section/s1", "veloq://fitness?range=3m", "veloq://route/r1", "veloq://insights"),
      rows.map { it.url },
    )
  }

  @Test
  fun the_largest_size_counts_the_rows_it_has_no_room_for_and_the_others_do_not() {
    assertEquals(1, InsightsWidget.content(snapshot(), SummarySize.LARGE, null).more)
    assertEquals(0, InsightsWidget.content(snapshot(), SummarySize.MEDIUM, null).more)
    assertEquals(0, InsightsWidget.content(snapshot(), SummarySize.SMALL, null).more)
    assertEquals(0, InsightsWidget.content(snapshot(ranked.take(4)), SummarySize.LARGE, null).more)
  }

  @Test
  fun a_kind_pick_removes_the_other_kinds_before_the_rows_are_counted() {
    val picked = setOf("section_pr", "route", "period_comparison", "stale_pr")
    assertEquals(listOf("a", "c", "d", "e"), ids(SummarySize.LARGE, picked))
    assertEquals(listOf("a", "c"), ids(SummarySize.MEDIUM, picked))
    assertEquals(0, InsightsWidget.content(snapshot(), SummarySize.LARGE, picked).more)
    assertEquals(listOf("b"), ids(SummarySize.LARGE, setOf("hrv_trend")))
  }

  @Test
  fun a_pick_of_no_kind_the_app_ranks_lists_every_kind() {
    assertEquals(listOf("a", "b", "c", "d"), ids(SummarySize.LARGE, emptySet()))
    assertEquals(listOf("a", "b", "c", "d"), ids(SummarySize.LARGE, setOf("not_a_kind")))
  }

  @Test
  fun a_pick_of_every_kind_is_stored_as_following_every_kind() {
    assertNull(InsightsWidget.normalise(InsightsWidget.KINDS))
    assertNull(InsightsWidget.normalise(emptyList()))
    assertNull(InsightsWidget.normalise(listOf("not_a_kind")))
    assertEquals(setOf("route"), InsightsWidget.normalise(listOf("route", "not_a_kind")))
  }

  @Test
  fun a_snapshot_with_no_insights_has_no_rows() {
    assertTrue(InsightsWidget.content(snapshot(emptyList()), SummarySize.LARGE, null).rows.isEmpty())
    assertTrue(InsightsWidget.content(snapshot(null), SummarySize.LARGE, null).rows.isEmpty())
  }

  @Test
  fun a_row_with_no_title_or_link_is_not_drawn() {
    val broken = JSONObject().put("id", "x").put("category", "route")
    val snap = snapshot(listOf(broken, ranked[0]))
    assertEquals(listOf("a"), ids(SummarySize.LARGE, snap = snap))
  }

  @Test
  fun the_size_follows_the_cells_the_host_reports_as_the_summary_does() {
    assertEquals(SummarySize.SMALL, InsightsWidget.sizeFor(110, 110))
    assertEquals(SummarySize.MEDIUM, InsightsWidget.sizeFor(250, 110))
    assertEquals(SummarySize.LARGE, InsightsWidget.sizeFor(250, 200))
  }

  @Test
  fun a_snapshot_row_keeps_what_it_draws() {
    val row = InsightsWidget.content(snapshot(), SummarySize.SMALL, null).rows.single()
    assertEquals("section_pr", row.category)
    assertEquals("title a", row.title)
    assertEquals("subtitle a", row.subtitle)
    assertEquals("positive", row.tone)
    assertEquals("trending-up", row.icon)
  }
}
