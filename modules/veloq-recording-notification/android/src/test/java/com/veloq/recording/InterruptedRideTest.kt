package com.veloq.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: Android kills the process mid-ride with the app in the background, and starts it again for
 * the next location broadcast. The location service cannot come back from there and no JavaScript runs.
 *
 * Expected behaviour: the start that follows a live ride finds the notice the ride armed, once, and a
 * start that follows a ride ended the ordinary way finds nothing.
 */
class InterruptedRideTest {
  private class MemoryStore : InterruptedRideStore {
    var saved: InterruptedRideNotice? = null
    var writes = 0

    override fun read() = saved

    override fun write(notice: InterruptedRideNotice) {
      saved = notice
      writes++
    }

    override fun remove() {
      saved = null
    }
  }

  private val ride = InterruptedRideNotice(
    session = 1_791_505_100_000,
    channel = "Interrupted recordings",
    title = "Recording stopped",
    body = "Tap to resume"
  )

  @Test
  fun a_process_that_died_mid_ride_leaves_the_notice_for_the_next_start() {
    val store = MemoryStore()
    InterruptedRide(store).armed(ride)

    assertEquals(ride, InterruptedRide(store).takeAtProcessStart())
  }

  @Test
  fun a_ride_that_ended_leaves_nothing_for_the_next_start() {
    val store = MemoryStore()
    InterruptedRide(store).apply {
      armed(ride)
      disarmed()
    }

    assertNull(InterruptedRide(store).takeAtProcessStart())
  }

  @Test
  fun the_notice_is_posted_once_and_not_at_every_later_start() {
    val store = MemoryStore()
    InterruptedRide(store).armed(ride)
    InterruptedRide(store).takeAtProcessStart()

    assertNull(InterruptedRide(store).takeAtProcessStart())
  }

  @Test
  fun a_ride_resumed_after_the_notice_arms_it_again() {
    val store = MemoryStore()
    InterruptedRide(store).armed(ride)
    InterruptedRide(store).takeAtProcessStart()

    // True is what takes the posted notice down: the ride is recording again.
    assertTrue(InterruptedRide(store).armed(ride))
    assertEquals(ride, InterruptedRide(store).takeAtProcessStart())
  }

  @Test
  fun only_the_first_batch_of_a_live_ride_reports_an_arming() {
    val interrupted = InterruptedRide(MemoryStore())

    assertTrue(interrupted.armed(ride))
    assertFalse(interrupted.armed(ride))
    assertTrue(interrupted.armed(ride.copy(title = "Aufnahme gestoppt")))
  }

  @Test
  fun a_start_with_no_ride_ever_armed_finds_nothing() {
    assertNull(InterruptedRide(MemoryStore()).takeAtProcessStart())
  }

  @Test
  fun every_batch_of_the_same_ride_writes_the_store_once() {
    val store = MemoryStore()
    val interrupted = InterruptedRide(store)
    repeat(5) { interrupted.armed(ride) }

    assertEquals(1, store.writes)
  }

  @Test
  fun a_notice_missing_any_of_its_words_is_not_armed() {
    assertNull(InterruptedRide.notice(1L, "Interrupted recordings", "Recording stopped", ""))
    assertNull(InterruptedRide.notice(1L, null, "Recording stopped", "Tap to resume"))
    assertEquals(
      ride,
      InterruptedRide.notice(ride.session, ride.channel, ride.title, ride.body)
    )
  }
}
