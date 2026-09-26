package com.veloq

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: the messaging service reads one FCM data map and decides whether
 * the push is an activity event it takes, or one it hands to Expo.
 *
 * Expected behaviour: the worker's `{ event_type, activity_id }` is found
 * whether Expo wrapped it under `body` or left it flat, only the two activity
 * events count, and anything malformed is Expo's.
 */
class ActivityPushEventTest {
  @Test
  fun an_activity_event_wrapped_under_body_names_its_activity() {
    val data = mapOf(
      "body" to """{"event_type":"ACTIVITY_UPLOADED","athlete_id":"i1","activity_id":"i123"}""",
      "experienceId" to "@evan/veloq"
    )
    assertEquals("i123", ActivityPushEvent.activityIdOf(data))
  }

  @Test
  fun a_flat_activity_event_names_its_activity() {
    val data = mapOf("event_type" to "ACTIVITY_ANALYZED", "activity_id" to "i123")
    assertEquals("i123", ActivityPushEvent.activityIdOf(data))
  }

  @Test
  fun a_numeric_id_reads_as_the_same_id() {
    val data = mapOf("body" to """{"event_type":"ACTIVITY_UPLOADED","activity_id":123}""")
    assertEquals("123", ActivityPushEvent.activityIdOf(data))
  }

  @Test
  fun the_visible_push_carries_the_event_beside_its_tap_data() {
    val data = mapOf(
      "body" to """{"activityId":"i5","route":"/activity/i5","event_type":"ACTIVITY_UPLOADED","activity_id":"i5"}"""
    )
    assertEquals("i5", ActivityPushEvent.activityIdOf(data))
  }

  @Test
  fun a_wellness_event_is_not_taken() {
    val data = mapOf("body" to """{"event_type":"WELLNESS_UPDATED","athlete_id":"i1"}""")
    assertNull(ActivityPushEvent.activityIdOf(data))
  }

  @Test
  fun an_activity_event_with_no_id_is_not_taken() {
    assertNull(ActivityPushEvent.activityIdOf(mapOf("body" to """{"event_type":"ACTIVITY_UPLOADED"}""")))
    assertNull(ActivityPushEvent.activityIdOf(mapOf("event_type" to "ACTIVITY_UPLOADED", "activity_id" to "")))
  }

  @Test
  fun a_wake_with_no_event_or_a_body_that_will_not_parse_is_not_taken() {
    assertNull(ActivityPushEvent.activityIdOf(emptyMap()))
    assertNull(ActivityPushEvent.activityIdOf(mapOf("body" to "not json")))
    assertNull(ActivityPushEvent.activityIdOf(mapOf("body" to "[1,2]")))
  }
}
