package com.veloq

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Posts the enriched activity notification from native code.
 *
 * The channel, the tag and the tap target are the ones the JavaScript task
 * used, so an athlete sees one kind of entry whichever path posted it: the
 * `veloq-insights` channel the app creates at launch, `activity-<id>` as the
 * tag so a second post for the same ride replaces the first, and a tap that
 * opens the activity's summary through the app's own deep link.
 *
 * The icon and colour are the app's notification resources, which
 * `expo-notifications` writes at prebuild. This module cannot name them at
 * compile time, so they are looked up, and the launcher icon stands in when
 * they are absent.
 */
object ActivityNotificationPoster {
  const val CHANNEL_ID = "veloq-insights"

  @JvmStatic
  fun post(context: Context, activityId: String, title: String, body: String) {
    ensureChannel(context)
    val tap = Intent(Intent.ACTION_VIEW, Uri.parse("veloq://summary/$activityId"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val pending = PendingIntent.getActivity(
      context,
      activityId.hashCode(),
      tap,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setColor(colour(context))
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(pending)
      .setAutoCancel(true)
      .build()
    try {
      NotificationManagerCompat.from(context).notify("activity-$activityId", 0, notification)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS was withdrawn since the token was registered. The
      // library is up to date regardless, which is the half that matters.
    }
  }

  /**
   * The app creates this channel with the same name and importance on every
   * launch. Creating it again changes nothing the athlete set, and a push that
   * somehow beats the first launch still has somewhere to land.
   */
  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Activity Insights", NotificationManager.IMPORTANCE_HIGH)
    )
  }

  private fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    if (id != 0) return id
    // A notification with no icon is refused outright, so a package with no
    // launcher icon either, which is only ever a test harness, gets the
    // platform's.
    return context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
  }

  private fun colour(context: Context): Int {
    val id = context.resources.getIdentifier("notification_icon_color", "color", context.packageName)
    return if (id != 0) context.getColor(id) else NotificationCompat.COLOR_DEFAULT
  }
}
