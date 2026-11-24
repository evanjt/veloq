package com.veloq.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the module is alive but no JavaScript code has subscribed to its events, or the last
 * subscriber has left, and a notification button is pressed.
 *
 * Expected behaviour: the press is not reported as delivered, so the receiver queues it for the
 * next subscriber. It is reported delivered only while a subscriber is attached.
 */
class ActionRouteTest {
  private val sent = mutableListOf<Pair<String, Long>>()
  private val route = ActionRoute { action, session -> sent.add(action to session) }

  @Test
  fun a_press_with_no_subscriber_is_not_delivered() {
    assertFalse(route.dispatch("lap", 7L))
    assertTrue(sent.isEmpty())
  }

  @Test
  fun a_press_with_a_subscriber_is_delivered_once() {
    route.startObserving()

    assertTrue(route.dispatch("lap", 7L))
    assertEquals(listOf("lap" to 7L), sent)
  }

  @Test
  fun a_press_after_the_last_subscriber_leaves_is_not_delivered() {
    route.startObserving()
    route.stopObserving()

    assertFalse(route.dispatch("pause", 7L))
    assertTrue(sent.isEmpty())
  }

  @Test
  fun a_failing_send_is_not_delivered() {
    val failing = ActionRoute { _, _ -> throw IllegalStateException("runtime gone") }
    failing.startObserving()

    assertFalse(failing.dispatch("lap", 7L))
  }
}
