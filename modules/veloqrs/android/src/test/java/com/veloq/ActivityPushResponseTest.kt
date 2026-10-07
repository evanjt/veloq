package com.veloq

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityPushResponseTest {
  private val fallback = """{"title":"New activity","body":""}"""

  @Test
  fun an_engine_open_failure_posts_the_plain_entry() {
    val decision = ActivityPushResponse.resolve(null, "engine refused", { fallback })
    assertEquals("New activity", decision.notification?.getString("title"))
    assertEquals("engine refused", decision.failureReason)
  }

  @Test
  fun a_missing_or_malformed_answer_posts_the_plain_entry() {
    val recorded = mutableListOf<String>()
    for (answer in listOf(null, "not json")) {
      val decision = ActivityPushResponse.resolve(answer, null, { fallback }) { recorded.add(it) }
      assertEquals("New activity", decision.notification?.getString("title"))
      assertEquals(if (answer == null) "native answer missing" else "native answer malformed", decision.failureReason)
    }
    assertEquals(listOf("native answer missing", "native answer malformed"), recorded)
  }

  @Test
  fun a_switch_or_athlete_refusal_posts_nothing() {
    val decision = ActivityPushResponse.resolve("""{"skip":true}""", null, { fallback })
    assertNull(decision.notification)
    assertNull(decision.failureReason)
  }

  @Test
  fun a_stored_ride_refreshes_the_widget() {
    for (answer in listOf("""{"title":"New PR","body":"Hill climb"}""", """{"title":"New activity","body":"Lunch ride"}""")) {
      assertTrue(ActivityPushResponse.resolve(answer, null, { fallback }).refreshesWidget)
    }
  }

  @Test
  fun a_refusal_or_a_failed_run_leaves_the_widget_alone() {
    assertFalse(ActivityPushResponse.resolve("""{"skip":true}""", null, { fallback }).refreshesWidget)
    assertFalse(ActivityPushResponse.resolve(null, null, { fallback }).refreshesWidget)
    assertFalse(ActivityPushResponse.resolve(null, "engine refused", { fallback }).refreshesWidget)
    assertFalse(ActivityPushResponse.resolve(null, "engine refused", { null }).refreshesWidget)
  }
}

class ActivityPushGateTest {
  private val ready = PushCredential.Stored.Ready(PushCredential("oauth", "tok", "i2"))

  @Test
  fun a_signed_out_device_posts_nothing() {
    assertEquals(ActivityPushResponse.Gate.Silent, ActivityPushResponse.gate(PushCredential.Stored.SignedOut, "i1"))
  }

  @Test
  fun another_athletes_push_posts_nothing() {
    assertEquals(ActivityPushResponse.Gate.Silent, ActivityPushResponse.gate(ready, "i1"))
  }

  @Test
  fun an_unreadable_store_keeps_the_plain_entry() {
    assertEquals(ActivityPushResponse.Gate.Unreadable, ActivityPushResponse.gate(PushCredential.Stored.Unreadable, "i1"))
  }

  @Test
  fun the_same_athlete_is_ready() {
    assertEquals(ActivityPushResponse.Gate.Ready(PushCredential("oauth", "tok", "i2")), ActivityPushResponse.gate(ready, "i2"))
  }
}
