package com.veloq

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.service.notification.StatusBarNotification
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Scenario: the push worker has a title and a body from Rust and posts them
 * from native code, in a process with no JavaScript.
 *
 * Expected behaviour: the entry is on the tray under the tag the JavaScript
 * task used, on the channel the app creates, carrying the title and the body,
 * and a second post for the same ride replaces the first rather than standing
 * beside it.
 *
 * Runs on a device: the tray is the notification manager's, which has no JVM
 * stand-in.
 */
@RunWith(AndroidJUnit4::class)
class ActivityNotificationPosterTest {
  private val context: Context
    get() = InstrumentationRegistry.getInstrumentation().targetContext

  private val manager: NotificationManager
    get() = context.getSystemService(NotificationManager::class.java)

  @Before
  fun grantPosting() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
        context.packageName,
        Manifest.permission.POST_NOTIFICATIONS
      )
    }
  }

  @After
  fun clearTray() {
    manager.cancelAll()
    awaitTray { manager.activeNotifications.isEmpty() }
  }

  private fun posted(tag: String) =
    manager.activeNotifications.filter { it.tag == tag }

  /**
   * The tray is the system's, and it is written to asynchronously: a read
   * taken straight after a post, or straight after the previous test's
   * `cancelAll`, can still be the state before it. Every assertion below is
   * on the settled tray, so poll to a deadline rather than read once.
   */
  private fun awaitTray(settled: () -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + SETTLE_MS
    while (!settled() && SystemClock.uptimeMillis() < deadline) {
      Thread.sleep(POLL_MS)
    }
  }

  /** The entries under `tag`, once one of them carries `title`. */
  private fun awaitEntry(tag: String, title: String): List<StatusBarNotification> {
    awaitTray { posted(tag).any { it.notification.title() == title } }
    return posted(tag)
  }

  private fun android.app.Notification.title() =
    extras.getCharSequence("android.title")?.toString()

  @Test
  fun the_entry_lands_under_the_activity_tag_on_the_insights_channel() {
    ActivityNotificationPoster.post(context, "i77", "New PR", "PR on Church Hill (12s faster)")

    val entries = awaitEntry("activity-i77", "New PR")
    assertEquals(1, entries.size)
    val notification = entries.single().notification
    assertEquals("New PR", notification.extras.getCharSequence("android.title").toString())
    assertEquals(
      "PR on Church Hill (12s faster)",
      notification.extras.getCharSequence("android.text").toString()
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      assertEquals(ActivityNotificationPoster.CHANNEL_ID, notification.channelId)
      assertNotNull(manager.getNotificationChannel(ActivityNotificationPoster.CHANNEL_ID))
    }
    assertNotNull(notification.contentIntent)
  }

  @Test
  fun a_second_post_for_the_same_ride_replaces_the_first() {
    ActivityNotificationPoster.post(context, "i78", "Activity Recorded", "On Church Hill")
    ActivityNotificationPoster.post(context, "i78", "New PR", "PR on Church Hill")

    val entries = awaitEntry("activity-i78", "New PR")
    assertEquals(1, entries.size)
    assertEquals("New PR", entries.single().notification.title())
  }

  @Test
  fun two_rides_are_two_entries() {
    ActivityNotificationPoster.post(context, "i79", "New PR", "PR on Church Hill")
    ActivityNotificationPoster.post(context, "i80", "New PR", "PR on Mill Road")

    assertEquals(1, awaitEntry("activity-i79", "New PR").size)
    assertEquals(1, awaitEntry("activity-i80", "New PR").size)
  }

  private companion object {
    const val SETTLE_MS = 5_000L
    const val POLL_MS = 50L
  }
}
