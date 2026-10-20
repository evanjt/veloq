package com.veloq.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the Strength widget draws the snapshot's strength block on the body, over the last 30
 * days, at whatever size the launcher gives it.
 *
 * Expected behaviour: the front body at the smallest sizes, front and back at medium, and both
 * with the window's top muscles at large in the snapshot's order. A snapshot written while the
 * calendar month was still offered draws its last 30 days. A window with no sessions draws its words and no body,
 * since an unshaded body reads as zero load. No snapshot, an empty library or a snapshot written
 * before the block draw the prompt every widget draws before a first snapshot.
 */
class StrengthWidgetTest {
  private fun muscle(slug: String, shade: Int): JSONObject =
    JSONObject().put("slug", slug).put("shade", shade)

  private fun top(
    slug: String,
    name: String,
    sets: String,
    volume: String?,
    frequency: String? = null,
  ): JSONObject {
    val row =
      JSONObject()
        .put("slug", slug)
        .put("name", name)
        .put("setsText", sets)
        .put("volumeText", volume ?: JSONObject.NULL)
    if (frequency != null) row.put("frequencyText", frequency)
    return row
  }

  private fun window(
    label: String,
    muscles: List<JSONObject>,
    tops: List<JSONObject>,
    emptyText: String? = null,
  ): JSONObject =
    JSONObject()
      .put("label", label)
      .put("activityCount", if (emptyText == null) 2 else 0)
      .put("totalSets", 17)
      .put("owedCount", 0)
      .put("maxWeightedSets", 7.0)
      .put("muscles", JSONArray(muscles))
      .put("top", JSONArray(tops))
      .put("emptyText", emptyText ?: JSONObject.NULL)

  private val last30 =
    window(
      "Last 30 days",
      listOf(
        muscle("gluteal", 5),
        muscle("triceps", 4),
        muscle("chest", 3),
        muscle("calves", 1),
        muscle("biceps", 2),
      ),
      listOf(
        top("gluteal", "Glutes", "7 sets", "4960 kg"),
        top("triceps", "Triceps", "6 sets", "2640 kg"),
        top("chest", "Chest", "4.5 sets", null),
        top("biceps", "Biceps", "3 sets", "900 kg"),
      ),
    )

  private fun snapshot(
    last30: JSONObject = this.last30,
    body: String = "male",
    display: JSONObject = JSONObject(),
    emptyLibrary: Boolean = false,
    withStrength: Boolean = true,
  ): WidgetSnapshot {
    val root = JSONObject().put("emptyLibrary", emptyLibrary).put("display", display)
    if (withStrength) {
      root.put(
        "strength",
        JSONObject()
          .put("body", body)
          .put("url", "veloq://insights?tab=strength&period=1m")
          .put("windows", JSONObject().put("last30", last30)),
      )
    }
    return WidgetSnapshot.parse(root)
  }

  private fun content(size: SummarySize, snap: WidgetSnapshot? = snapshot()) =
    StrengthWidget.content(snap, size)

  @Test
  fun small_draws_the_front_only() {
    assertEquals(listOf(BodyOutline.Side.FRONT), content(SummarySize.SMALL)!!.sides)
    assertEquals(listOf(BodyOutline.Side.FRONT), content(SummarySize.SHORT)!!.sides)
    assertTrue(content(SummarySize.SMALL)!!.top.isEmpty())
  }

  @Test
  fun medium_draws_front_and_back_and_no_rows() {
    val medium = content(SummarySize.MEDIUM)!!
    assertEquals(listOf(BodyOutline.Side.FRONT, BodyOutline.Side.BACK), medium.sides)
    assertTrue(medium.top.isEmpty())
  }

  @Test
  fun large_draws_both_sides_and_the_four_top_rows_in_the_snapshot_order() {
    val large = content(SummarySize.LARGE)!!
    assertEquals(listOf(BodyOutline.Side.FRONT, BodyOutline.Side.BACK), large.sides)
    assertEquals(listOf("Glutes", "Triceps", "Chest", "Biceps"), large.top.map { it.name })
    assertEquals(listOf("7 sets", "6 sets", "4.5 sets", "3 sets"), large.top.map { it.setsText })
    assertEquals(listOf("4960 kg", "2640 kg", null, "900 kg"), large.top.map { it.volumeText })
  }

  @Test
  fun a_large_row_reads_how_often_a_week_then_the_sets_then_the_volume() {
    val rows =
      listOf(
        top("chest", "Chest", "14 sets", "4960 kg", frequency = "2.2×/wk"),
        top("abs", "Abs", "6 sets", null, frequency = "0.7×/wk"),
        top("calves", "Calves", "3 sets", "900 kg"),
      )
    val snap = snapshot(last30 = window("Last 30 days", listOf(muscle("chest", 5)), rows))
    assertEquals(
      listOf("2.2×/wk · 14 sets · 4960 kg", "0.7×/wk · 6 sets", "3 sets · 900 kg"),
      content(SummarySize.LARGE, snap)!!.top.map { it.detail },
    )
  }

  @Test
  fun large_never_lists_more_than_four_rows() {
    val five = (1..5).map { top("m$it", "Muscle $it", "$it sets", null) }
    val snap = snapshot(last30 = window("Last 30 days", listOf(muscle("m1", 5)), five))
    assertEquals(
      listOf("Muscle 1", "Muscle 2", "Muscle 3", "Muscle 4"),
      content(SummarySize.LARGE, snap)!!.top.map { it.name },
    )
  }

  @Test
  fun a_snapshot_that_still_carries_the_calendar_month_draws_the_last_30_days() {
    val month =
      window(
        "October",
        listOf(muscle("quadriceps", 5)),
        listOf(top("quadriceps", "Quadriceps", "5 sets", "3000 kg")),
      )
    val root =
      JSONObject()
        .put("emptyLibrary", false)
        .put("display", JSONObject())
        .put(
          "strength",
          JSONObject()
            .put("body", "male")
            .put("url", "veloq://insights?tab=strength&period=1m")
            .put("windows", JSONObject().put("month", month).put("last30", last30)),
        )
    val drawn = content(SummarySize.LARGE, WidgetSnapshot.parse(root))!!
    assertEquals("Last 30 days", drawn.label)
    assertEquals(listOf("Glutes", "Triceps", "Chest", "Biceps"), drawn.top.map { it.name })
    assertEquals(0, drawn.shadeOf("quadriceps"))
  }

  @Test
  fun each_trained_muscle_takes_its_shade_and_every_other_part_the_body_fill() {
    val c = content(SummarySize.MEDIUM)!!
    assertEquals(5, c.shadeOf("gluteal"))
    assertEquals(1, c.shadeOf("calves"))
    assertEquals(0, c.shadeOf("head"))
    assertEquals(0, c.shadeOf("upper-back"))
  }

  @Test
  fun a_shade_outside_the_ramp_is_held_to_its_ends() {
    val shades = listOf(muscle("chest", 9), muscle("abs", 0), muscle("biceps", -2))
    val snap = snapshot(last30 = window("Last 30 days", shades, emptyList()))
    val c = content(SummarySize.SMALL, snap)!!
    assertEquals(StrengthWidget.SHADES, c.shadeOf("chest"))
    assertEquals(0, c.shadeOf("abs"))
    assertEquals(0, c.shadeOf("biceps"))
  }

  @Test
  fun a_window_with_empty_text_draws_the_text_and_no_body() {
    val words = "No strength workouts in the last 1 month"
    val snap =
      snapshot(last30 = window("Last 30 days", emptyList(), emptyList(), emptyText = words))
    for (size in SummarySize.values()) {
      val c = content(size, snap)!!
      assertEquals(words, c.emptyText)
      assertTrue("$size draws a body", c.sides.isEmpty())
      assertTrue(c.top.isEmpty())
      assertNull(c.bodyLabel)
    }
    assertNull(content(SummarySize.LARGE)!!.emptyText)
    assertFalse(content(SummarySize.LARGE)!!.sides.isEmpty())
  }

  @Test
  fun no_snapshot_an_empty_library_or_a_snapshot_before_the_block_draws_the_prompt() {
    assertNull(content(SummarySize.MEDIUM, null))
    assertNull(content(SummarySize.MEDIUM, snapshot(emptyLibrary = true)))
    assertNull(content(SummarySize.MEDIUM, snapshot(withStrength = false)))
  }

  @Test
  fun a_sample_snapshot_keeps_its_demo_label() {
    val sample = snapshot(display = JSONObject().put("demoLabel", "Demo Mode"))
    assertEquals("Demo Mode", content(SummarySize.SMALL, sample)!!.demoLabel)
    assertNull(content(SummarySize.SMALL)!!.demoLabel)
  }

  @Test
  fun the_body_follows_the_athlete_and_the_tap_opens_the_block_link() {
    assertFalse(content(SummarySize.SMALL)!!.female)
    assertTrue(content(SummarySize.SMALL, snapshot(body = "female"))!!.female)
    assertEquals("veloq://insights?tab=strength&period=1m", content(SummarySize.SMALL)!!.url)
  }

  @Test
  fun a_muscle_entry_with_no_slug_or_a_row_with_no_name_is_dropped() {
    val snap =
      snapshot(
        last30 =
          window(
            "Last 30 days",
            listOf(JSONObject().put("shade", 3), muscle("chest", 3)),
            listOf(JSONObject().put("slug", "x"), top("chest", "Chest", "3 sets", null)),
          ))
    val c = content(SummarySize.LARGE, snap)!!
    assertEquals(listOf("Chest"), c.top.map { it.name })
    assertEquals(3, c.shadeOf("chest"))
  }
}
