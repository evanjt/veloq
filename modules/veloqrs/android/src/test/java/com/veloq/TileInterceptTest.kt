package com.veloq

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Scenario: the page asks the interceptor for a heatmap tile. The interceptor
 * runs on the WebView's own pool of a few threads, which also hands finished
 * responses to the page, so it answers only from what the engine holds.
 *
 * Expected behaviour: a tile held is answered with its bytes, a refusal and a
 * throttle with their own status, and a tile not held with a 404, all at once.
 */
class TileInterceptTest {

  /** The engine's side, answering from fixed maps. */
  private class HeldTiles(
    private val held: Map<String, ByteArray> = emptyMap(),
    private val refused: Map<String, Int> = emptyMap(),
  ) : TileIntercept.Tiles {
    var asked = 0

    override fun answer(source: String, z: Int, x: Int, y: Int, status: IntArray): ByteArray? {
      asked++
      val key = "$source/$z/$x/$y"
      held[key]?.let {
        status[0] = 200
        return it
      }
      status[0] = refused[key] ?: 404
      return null
    }
  }

  @Test
  fun a_held_tile_is_answered_with_its_bytes() {
    val tiles = HeldTiles(held = mapOf("heatmap/14/8000/5000" to TILE))
    val answer = TileIntercept(tiles).answer("heatmap/14/8000/5000.png?v=2")

    assertEquals(200, answer.status)
    assertEquals("image/png", answer.mime)
    assertArrayEquals(TILE, answer.body.readBytes())
  }

  @Test
  fun a_source_the_engine_holds_back_is_answered_with_its_status() {
    val tiles = HeldTiles(refused = mapOf("heatmap/14/8001/5000" to 429))
    val answer = TileIntercept(tiles).answer("heatmap/14/8001/5000.png")

    assertEquals(429, answer.status)
    assertEquals("Too Many Requests", answer.reason)
    assertEquals(-1, answer.body.read())
  }

  @Test
  fun a_tile_not_held_is_a_404_with_no_body() {
    val answer = TileIntercept(HeldTiles()).answer("heatmap/14/1/1.png")

    assertEquals(404, answer.status)
    assertEquals("No Tile", answer.reason)
    assertEquals(-1, answer.body.read())
  }

  @Test
  fun a_path_that_is_not_a_tile_is_refused_without_asking_the_engine() {
    val tiles = HeldTiles()

    assertEquals(400, TileIntercept(tiles).answer("heatmap/14/8000").status)
    assertEquals(400, TileIntercept(tiles).answer("heatmap/z/8000/5000.png").status)
    assertEquals(0, tiles.asked)
  }

  private companion object {
    val TILE = byteArrayOf(0x1a, 0x2b, 0x3c, 0x4d)
  }
}
