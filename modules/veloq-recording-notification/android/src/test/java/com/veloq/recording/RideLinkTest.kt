package com.veloq.recording

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Scenario: mid-ride the rider opens another screen in the app, goes home, and taps a ride
 * notification.
 *
 * Expected behaviour: both the recording notification and the interrupted notice open the record
 * screen in the app's own task, rather than resuming whichever screen was last in front.
 */
class RideLinkTest {
  private val app = "fit.example.rides"

  @Test
  fun the_recording_notification_opens_the_record_screen() {
    val link = RideLink.recording(app)

    assertEquals("veloq://record", link.url)
    assertEquals(app, link.packageName)
    assertEquals(Intent.FLAG_ACTIVITY_SINGLE_TOP, link.flags and Intent.FLAG_ACTIVITY_SINGLE_TOP)
    assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK, link.flags and Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  @Test
  fun the_interrupted_notice_opens_the_same_screen_as_the_recording_notification() {
    val recording = RideLink.recording(app)
    val interrupted = RideLink.interrupted(app)

    assertEquals(recording.url, interrupted.url)
    assertEquals(recording.packageName, interrupted.packageName)
    assertEquals(recording.flags, interrupted.flags)
  }

  @Test
  fun the_two_notifications_hold_separate_pending_intents() {
    assertNotEquals(RideLink.recording(app).requestCode, RideLink.interrupted(app).requestCode)
  }
}
