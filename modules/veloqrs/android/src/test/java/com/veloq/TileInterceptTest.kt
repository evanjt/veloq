package com.veloq

import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Scenario: a pan over new ground asks the interceptor for two dozen tiles the
 * store does not hold. The interceptor runs on the WebView's own pool of a few
 * threads, which also hands finished responses to the page.
 *
 * Expected behaviour: a miss is answered before its fetch has run, with a body
 * that yields the tile once the engine completes it, or fails as a network
 * error when the host refused. A tile already held, a refusal and a throttle
 * are answered at once with their own status.
 */
class TileInterceptTest {

  /** The engine's side, with every fetch queued until the test runs it. */
  private class QueuedTiles(
    private val held: Map<String, ByteArray> = emptyMap(),
    private val refused: Map<String, Int> = emptyMap(),
  ) : TileIntercept.Tiles {
    val fetches = ArrayDeque<(PendingTile) -> Unit>()
    val pendings = ArrayDeque<PendingTile>()
    var asked = 0

    var nextFetch: (PendingTile) -> Unit = { it.complete(TILE) }

    override fun answer(
      source: String,
      z: Int,
      x: Int,
      y: Int,
      status: IntArray,
      pending: PendingTile,
    ): ByteArray? {
      asked++
      val key = "$source/$z/$x/$y"
      held[key]?.let {
        status[0] = 200
        return it
      }
      refused[key]?.let {
        status[0] = it
        return null
      }
      val fetch = nextFetch
      fetches.addLast(fetch)
      pendings.addLast(pending)
      status[0] = TileBridge.PENDING
      return null
    }

    fun runNextFetch() {
      fetches.removeFirst()(pendings.removeFirst())
    }
  }

  @Test
  fun a_miss_is_answered_before_its_fetch_has_run() {
    val tiles = QueuedTiles()
    val answer = TileIntercept(tiles).answer("openmaptiles/14/8000/5000.pbf")

    assertEquals(200, answer.status)
    assertEquals("application/x-protobuf", answer.mime)
    assertEquals(1, tiles.fetches.size)
    assertFalse((answer.body as PendingTile).isSettled())
  }

  @Test
  fun the_body_of_a_miss_yields_the_tile_once_the_fetch_completes() {
    val tiles = QueuedTiles()
    val answer = TileIntercept(tiles).answer("openmaptiles/14/8000/5000.pbf")

    val reader = Thread { tiles.runNextFetch() }
    reader.start()
    val read = answer.body.readBytes()
    reader.join()

    assertArrayEquals(TILE, read)
  }

  @Test
  fun a_reader_already_waiting_is_woken_by_the_fetch() {
    val tiles = QueuedTiles()
    val answer = TileIntercept(tiles).answer("satellite-eox/14/8000/5000.jpg")
    var read: ByteArray? = null

    val reader = Thread { read = answer.body.readBytes() }
    reader.start()
    while (reader.state != Thread.State.TIMED_WAITING && reader.isAlive) Thread.yield()
    tiles.runNextFetch()
    reader.join(5_000)

    assertFalse(reader.isAlive)
    assertArrayEquals(TILE, read)
  }

  @Test
  fun a_fetch_refused_with_429_fails_the_body_as_a_network_error() {
    val tiles = QueuedTiles()
    tiles.nextFetch = { it.fail(429) }
    val answer = TileIntercept(tiles).answer("openmaptiles/14/8000/5000.pbf")
    tiles.runNextFetch()

    try {
      answer.body.read()
      fail("a refused fetch must fail the body")
    } catch (expected: IOException) {
      assertTrue(expected.message!!.contains("429"))
    }
  }

  @Test
  fun a_source_the_engine_holds_back_is_answered_with_its_status_and_no_fetch() {
    val tiles = QueuedTiles(refused = mapOf("openmaptiles/14/8001/5000" to 429))
    val answer = TileIntercept(tiles).answer("openmaptiles/14/8001/5000.pbf")

    assertEquals(429, answer.status)
    assertEquals("Too Many Requests", answer.reason)
    assertEquals(-1, answer.body.read())
    assertEquals(0, tiles.fetches.size)
  }

  @Test
  fun a_held_tile_is_answered_with_its_bytes() {
    val tiles = QueuedTiles(held = mapOf("openmaptiles/14/8000/5000" to TILE))
    val answer = TileIntercept(tiles).answer("openmaptiles/14/8000/5000.pbf?v=2")

    assertEquals(200, answer.status)
    assertArrayEquals(TILE, answer.body.readBytes())
    assertEquals(0, tiles.fetches.size)
  }

  @Test
  fun a_refusal_with_no_bytes_is_a_404() {
    val tiles = QueuedTiles(refused = mapOf("swisstopo/14/1/1" to 404))
    val answer = TileIntercept(tiles).answer("swisstopo/14/1/1.jpeg")

    assertEquals(404, answer.status)
    assertEquals("No Tile", answer.reason)
  }

  @Test
  fun a_path_that_is_not_a_tile_is_refused_without_asking_the_engine() {
    val tiles = QueuedTiles()

    assertEquals(400, TileIntercept(tiles).answer("openmaptiles/14/8000").status)
    assertEquals(400, TileIntercept(tiles).answer("openmaptiles/z/8000/5000.pbf").status)
    assertEquals(0, tiles.asked)
  }

  @Test
  fun a_body_the_engine_never_completes_fails_at_its_deadline() {
    val pending = PendingTile(50)

    try {
      pending.read(ByteArray(16), 0, 16)
      fail("a body nobody completes must not wait for good")
    } catch (expected: IOException) {
      assertTrue(pending.isSettled())
    }
  }

  @Test
  fun a_second_answer_does_not_replace_the_first() {
    val pending = PendingTile()
    pending.complete(TILE)
    pending.fail(503)

    assertArrayEquals(TILE, pending.readBytes())
  }

  private companion object {
    val TILE = byteArrayOf(0x1a, 0x2b, 0x3c, 0x4d)
  }
}
