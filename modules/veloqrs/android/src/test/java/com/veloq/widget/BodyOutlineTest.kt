package com.veloq.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the strength widget draws the body from the generated outlines, so an encoding that
 * drops a muscle or a decoder that misreads the string leaves a hole where the app shows a shade.
 *
 * Expected behaviour: every muscle the engine can shade, and the parts nobody trains, decode to
 * real polygons on both bodies, inside the unit box the widget scales to its cell.
 */
class BodyOutlineTest {
  private val muscles =
    listOf(
      "abs",
      "adductors",
      "biceps",
      "calves",
      "chest",
      "deltoids",
      "forearm",
      "gluteal",
      "hamstring",
      "lower-back",
      "obliques",
      "quadriceps",
      "trapezius",
      "triceps",
      "upper-back",
    )

  private val bodies = listOf(false, true)

  private fun polygonsOf(female: Boolean, slug: String): List<FloatArray> =
    BodyOutline.Side.values().flatMap { side ->
      BodyOutline.parts(female, side).filter { it.slug == slug }.flatMap { it.polygons }
    }

  @Test
  fun every_muscle_the_engine_shades_has_a_polygon_on_both_bodies() {
    for (female in bodies) {
      for (slug in muscles) {
        val polygons = polygonsOf(female, slug)
        assertTrue("$slug on female=$female has no polygon", polygons.isNotEmpty())
        assertTrue(
          "$slug on female=$female has a polygon under three points",
          polygons.all { it.size >= 6 && it.size % 2 == 0 },
        )
      }
    }
  }

  @Test
  fun the_untrainable_parts_decode_too() {
    for (female in bodies) {
      for (slug in listOf("head", "hands", "feet")) {
        assertTrue("$slug on female=$female", polygonsOf(female, slug).any { it.size >= 6 })
      }
    }
  }

  @Test
  fun every_coordinate_lies_in_the_unit_box() {
    for (female in bodies) {
      for (side in BodyOutline.Side.values()) {
        val parts = BodyOutline.parts(female, side)
        assertTrue(parts.isNotEmpty())
        for (part in parts) {
          for (polygon in part.polygons) {
            for (v in polygon) {
              assertTrue("${part.slug} $side female=$female: $v", v in 0f..1f)
            }
          }
        }
      }
    }
  }

  @Test
  fun the_front_and_back_draw_different_parts() {
    val front = BodyOutline.parts(false, BodyOutline.Side.FRONT).map { it.slug }
    val back = BodyOutline.parts(false, BodyOutline.Side.BACK).map { it.slug }
    assertTrue("chest" in front && "chest" !in back)
    assertTrue("gluteal" in back && "gluteal" !in front)
  }

  @Test
  fun a_part_decodes_ring_by_ring_in_ten_thousandths() {
    val parts = BodyOutline.decode(arrayOf("knees" to "0 0 10000 0 5000 2500;100 200 300 400 500 600"))
    assertEquals(1, parts.size)
    assertEquals("knees", parts[0].slug)
    assertEquals(2, parts[0].polygons.size)
    assertEquals(listOf(0f, 0f, 1f, 0f, 0.5f, 0.25f), parts[0].polygons[0].toList())
    assertEquals(listOf(0.01f, 0.02f, 0.03f, 0.04f, 0.05f, 0.06f), parts[0].polygons[1].toList())
  }
}
