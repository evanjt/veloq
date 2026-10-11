package com.veloq.recording

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

// The record entry, which offers an interrupted ride back or opens the one
// already live. The same link the record widget and the iOS Live Activity open.
private const val RECORD_URL = "veloq://record"

// A PendingIntent is keyed on its intent and request code, so the two
// notifications that open the ride each hold their own.
private const val RECORDING_REQUEST = 1
private const val INTERRUPTED_REQUEST = 2

/**
 * What a tap on a ride notification opens: the record screen, in the app's own task.
 *
 * Kept as data so the link is the same for every notification about the ride. A launcher intent
 * would resume whichever screen the rider left in front instead.
 */
data class RideLink(
  val url: String,
  val packageName: String,
  val flags: Int,
  val requestCode: Int
) {
  fun pendingIntent(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(packageName)
      .addFlags(flags)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  companion object {
    private const val FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP

    /** The ongoing notification of a live ride. */
    fun recording(packageName: String) = RideLink(RECORD_URL, packageName, FLAGS, RECORDING_REQUEST)

    /** The notice posted after a ride's process died. */
    fun interrupted(packageName: String) = RideLink(RECORD_URL, packageName, FLAGS, INTERRUPTED_REQUEST)
  }
}
