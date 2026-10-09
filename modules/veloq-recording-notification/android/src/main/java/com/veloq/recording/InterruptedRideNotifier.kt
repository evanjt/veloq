package com.veloq.recording

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat

private const val PREFERENCES = "veloq-recording-interrupted"
private const val KEY_SESSION = "session"
private const val KEY_CHANNEL = "channel"
private const val KEY_TITLE = "title"
private const val KEY_BODY = "body"

private const val CHANNEL_ID = "veloq-recording-interrupted"
private const val NOTICE_TAG = "veloq-recording-interrupted"
private const val NOTICE_ID = 0

// The record entry, which offers the interrupted ride back or opens the one
// already resumed. The same link the record widget opens.
private const val RESUME_URL = "veloq://record"

private class PreferencesStore(context: Context) : InterruptedRideStore {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  override fun read(): InterruptedRideNotice? =
    InterruptedRide.notice(
      preferences.getLong(KEY_SESSION, 0L),
      preferences.getString(KEY_CHANNEL, null),
      preferences.getString(KEY_TITLE, null),
      preferences.getString(KEY_BODY, null)
    )

  override fun write(notice: InterruptedRideNotice) {
    preferences.edit()
      .putLong(KEY_SESSION, notice.session)
      .putString(KEY_CHANNEL, notice.channel)
      .putString(KEY_TITLE, notice.title)
      .putString(KEY_BODY, notice.body)
      .apply()
  }

  // Committed rather than applied: the process may be about to die, and a notice
  // left behind would tell the next start a finished ride was cut off.
  override fun remove() {
    preferences.edit().clear().commit()
  }
}

/** The Android half of [InterruptedRide]: the store it keeps and the notification it posts. */
object InterruptedRideNotifier {
  fun of(context: Context) = InterruptedRide(PreferencesStore(context.applicationContext))

  /** Called as the process starts, before any JavaScript, which a restart for a broadcast never runs. */
  fun postIfInterrupted(context: Context) {
    val notice = of(context).takeAtProcessStart() ?: return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    // Default importance, unlike the silent service channel: the rider's phone
    // is in a pocket, and a ride that stopped recording is worth a sound.
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, notice.channel, NotificationManager.IMPORTANCE_DEFAULT)
    )
    manager.notify(NOTICE_TAG, NOTICE_ID, build(context, notice))
  }

  /** The ride is recording again, or the rider has dealt with it. */
  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java)?.cancel(NOTICE_TAG, NOTICE_ID)
  }

  private fun build(context: Context, notice: InterruptedRideNotice) =
    NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(notice.title)
      .setContentText(notice.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(notice.body))
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setAutoCancel(true)
      .setContentIntent(resume(context))
      .build()

  // A tap on a notification is one of the starts Android lets bring the
  // location service back, so the ride resumes from here.
  private fun resume(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(RESUME_URL))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }
}
