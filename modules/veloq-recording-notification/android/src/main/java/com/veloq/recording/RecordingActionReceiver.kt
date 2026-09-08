package com.veloq.recording

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.io.File

internal const val ACTION_EXTRA = "veloq.recording.action"
internal const val BROADCAST_ACTION = "com.veloq.recording.NOTIFICATION_ACTION"
private const val PENDING_FILE = "recording-notification-actions.txt"

/**
 * The notification's buttons. A button can be pressed after Android has torn the
 * JavaScript runtime down while the foreground service kept the notification up,
 * so a press with no listener is written to a file the module drains when a
 * runtime next installs its listener, rather than being dropped.
 */
class RecordingActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.getStringExtra(ACTION_EXTRA) ?: return
    if (VeloqRecordingNotificationModule.dispatch(action)) return
    appendPending(context, action)
  }

  companion object {
    private fun file(context: Context) = File(context.filesDir, PENDING_FILE)

    fun appendPending(context: Context, action: String) {
      file(context).appendText("$action\n")
    }

    /** Oldest first, and the queue is emptied by the read. */
    fun drainPending(context: Context): List<String> {
      val f = file(context)
      if (!f.exists()) return emptyList()
      val lines = f.readLines().filter { it.isNotBlank() }
      f.delete()
      return lines
    }
  }
}
