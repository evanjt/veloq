package com.veloq.recording

import android.app.ActivityManager
import android.content.Context

// The service expo-location runs the location task in. Named rather than derived
// because `getRunningServices` reports a class name and nothing else identifies
// it.
private const val LOCATION_SERVICE_CLASS = "expo.modules.location.services.LocationTaskService"

/**
 * Whether a ride is recording, for the surfaces outside the app that ask, such
 * as the Quick Settings tile.
 *
 * Two signals, and both die with the process, so a ride the process lost is
 * never reported live. The ride notification is updated for every ride while
 * the JavaScript session runs, indoor ones included, which start no service.
 * The location service covers a GPS ride the service restarted into a process
 * whose JavaScript has not reported yet.
 */
object LiveRide {
  @Volatile
  internal var reported = false

  fun recording(context: Context): Boolean = reported || locationServiceRunning(context)

  /**
   * Whether the location foreground service is actually running.
   *
   * Two cheaper answers were measured on a device and both lie. The task
   * registry (`hasStartedLocationUpdatesAsync`) answers whether the task is
   * registered, and a ride that ended abnormally leaves it registered across a
   * process restart. The service's notification is worse: `manager.notify`
   * takes ownership of the id, so a re-posted one outlives both the service
   * and the process, and was measured still on screen with no app process
   * alive at all.
   *
   * `getRunningServices` is deprecated and still correct here: since Android 8
   * it returns only the caller's own services, which is exactly the scope
   * wanted. A dead service is simply absent, and nothing stale can add one.
   */
  @Suppress("DEPRECATION")
  fun locationServiceRunning(context: Context): Boolean {
    val manager = context.getSystemService(ActivityManager::class.java) ?: return false
    return manager.getRunningServices(Int.MAX_VALUE).any {
      it.service.className == LOCATION_SERVICE_CLASS && it.foreground
    }
  }
}
