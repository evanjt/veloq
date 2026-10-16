package com.veloq.recording

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * The foreground service an indoor ride holds while the app is out of the foreground.
 *
 * An indoor ride runs no location service, and Android freezes a backgrounded app that holds no
 * foreground service, so the sensors' notifications stop reaching the ride the moment the screen
 * locks. This service does nothing but exist: its notification is the one the ride's own is posted
 * over, the same as the location service's, and its type is the one for keeping a connection to an
 * external device, which the paired sensors are.
 */
class IndoorRecordingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Recording" }
    // Low importance, like the location service's channel: the notification is a
    // status line with buttons, not something to sound for. Channels exist from
    // Android 8, and before it the builder ignores the id.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java)?.createNotificationChannel(
        NotificationChannel(channelId(this), title, NotificationManager.IMPORTANCE_LOW)
      )
    }
    val notification = NotificationCompat.Builder(this, channelId(this))
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .build()
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, foregroundType())
    } catch (e: Exception) {
      // `start` checks the prerequisites first, so this is a platform that
      // added one. Nothing can keep the ride alive then, and holding a service
      // that is not in the foreground only earns a kill.
      Log.w(TAG, "indoor recording service refused", e)
      stopSelf()
    }
    // A process that died with the ride has no ride to keep alive. The
    // interrupted-ride notice tells the rider at the next start.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun foregroundType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    } else {
      0
    }

  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }

  companion object {
    private const val TAG = "VeloqIndoorRecording"
    private const val EXTRA_TITLE = "title"
    private const val NOTIFICATION_ID = 0x5e10

    /**
     * The channel the service posts on. The ride's notification is found by its
     * suffix, the way the location service's is found by the task name.
     */
    fun channelId(context: Context) = "${context.packageName}:$INDOOR_CHANNEL_SUFFIX"

    /**
     * True when the service was asked for. False when its prerequisites are
     * missing or Android refused a start from the background, in which case the
     * caller asks again once the app is in front.
     */
    fun start(context: Context, title: String): Boolean {
      val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED
      if (!IndoorServicePrerequisites.met(Build.VERSION.SDK_INT, granted)) return false
      val intent = Intent(context, IndoorRecordingService::class.java).putExtra(EXTRA_TITLE, title)
      return try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (e: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException: the app is not in front.
        Log.w(TAG, "indoor recording service not allowed to start", e)
        false
      } catch (e: SecurityException) {
        Log.w(TAG, "indoor recording service not permitted", e)
        false
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, IndoorRecordingService::class.java))
    }
  }
}

/** The channel suffix the indoor service posts on, beside the location task's. */
const val INDOOR_CHANNEL_SUFFIX = "veloq-indoor-recording"

/**
 * Whether the connected-device foreground service may start.
 *
 * From Android 14 `startForeground` of this type throws unless the app holds one of the device
 * permissions, and a service started for the foreground that never gets there takes the process down.
 * Bluetooth connect is the one an indoor ride's sensors already need, so without it there is nothing
 * the service would keep alive and it is not started.
 */
object IndoorServicePrerequisites {
  /** The release that first checks a foreground service type's prerequisites. */
  const val CHECKED_FROM_SDK = 34

  fun met(sdk: Int, bluetoothConnectGranted: Boolean): Boolean =
    sdk < CHECKED_FROM_SDK || bluetoothConnectGranted
}
