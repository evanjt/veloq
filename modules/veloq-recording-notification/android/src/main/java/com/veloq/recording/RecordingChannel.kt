package com.veloq.recording

import android.app.NotificationManager
import androidx.core.app.NotificationCompat

// Must match BACKGROUND_LOCATION_TASK in src/features/recording/lib/backgroundLocationTask.ts.
// expo-location names the foreground service's channel "<appId>:<taskName>"
// (LocationTaskService.onStartCommand), which is the only handle it exposes.
internal const val LOCATION_TASK_NAME = "veloq-background-location"

/** The recording service's channel as Android lists it in the app's notification settings. */
data class RecordingChannelSpec(
  val id: String,
  val name: String,
  val description: String,
  val importance: Int
)

/**
 * The channel the recording's foreground service posts on.
 *
 * expo-location creates the channel only when it is absent, named after the app and described in
 * English, so creating it first under the same id is what puts the rider's language there.
 * Creating it again with the same id renames it in place and leaves the importance and anything
 * the rider set alone.
 */
object RecordingChannel {
  /**
   * expo-location's id for the channel: the app scope key, which is the package name in an app
   * with no Expo host, then the task name.
   */
  fun id(packageName: String) = "$packageName:$LOCATION_TASK_NAME"

  /**
   * How the ride's notification shows on a lock screen that hides sensitive content: in full,
   * figures, clock and buttons, since the phone stays locked for the whole ride and a distance
   * and an elapsed time are nothing to hide. Set on the notification rather than the channel,
   * because Android stores a channel created as public as no override.
   */
  const val LOCK_SCREEN_VISIBILITY = NotificationCompat.VISIBILITY_PUBLIC

  /**
   * Silent, as expo-location makes it: the notification is up for the whole ride and only says
   * what the ride is doing. Null for a blank name, which is a bundle not yet loaded rather than a
   * name.
   */
  fun spec(packageName: String, name: String?, description: String?): RecordingChannelSpec? {
    if (name.isNullOrBlank()) return null
    return RecordingChannelSpec(
      id(packageName),
      name,
      description.orEmpty(),
      NotificationManager.IMPORTANCE_LOW
    )
  }
}
