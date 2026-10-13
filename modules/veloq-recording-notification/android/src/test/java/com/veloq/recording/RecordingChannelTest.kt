package com.veloq.recording

import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: the rider opens the app's notification settings, where every channel is listed by its
 * name and description, and the one the recording service posts on is created by the location
 * library unless it already exists.
 *
 * Expected behaviour: the recording channel is created first, under the location library's own id,
 * with the name and description in the rider's language, and stays silent.
 */
class RecordingChannelTest {
  private val app = "fit.example.rides"

  @Test
  fun the_channel_carries_the_translated_name_and_description_at_low_importance() {
    val spec = RecordingChannel.spec(app, "Aufzeichnung", "Zeigt die laufende Aufzeichnung")

    assertEquals("Aufzeichnung", spec?.name)
    assertEquals("Zeigt die laufende Aufzeichnung", spec?.description)
    assertEquals(NotificationManager.IMPORTANCE_LOW, spec?.importance)
  }

  @Test
  fun the_channel_takes_the_id_the_location_service_posts_on() {
    // The service names its channel "<app scope key>:<task name>", and the scope key of an app
    // with no Expo host is its package name.
    val spec = RecordingChannel.spec(app, "Recording", "")

    assertEquals("fit.example.rides:veloq-background-location", spec?.id)
  }

  @Test
  fun a_missing_description_is_empty_rather_than_refusing_the_name() {
    assertEquals("", RecordingChannel.spec(app, "Recording", null)?.description)
  }

  @Test
  fun a_blank_name_creates_nothing() {
    assertNull(RecordingChannel.spec(app, "", "Shows the ride"))
    assertNull(RecordingChannel.spec(app, "   ", "Shows the ride"))
    assertNull(RecordingChannel.spec(app, null, "Shows the ride"))
  }
}
