package expo.modules.location.records

import android.content.Context
import android.location.Location
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.location.LocationCompat
import androidx.core.location.altitude.AltitudeConverterCompat
import java.util.concurrent.Executors

// Android reports altitude above the WGS84 ellipsoid, iOS above mean sea level,
// which is the datum FIT and every other elevation source use. Every fix is
// given its sea-level altitude here, and one that cannot be converted reports
// no altitude rather than an ellipsoidal one.
internal object SeaLevelAltitude {
  private const val TAG = "SeaLevelAltitude"

  // The converter reads its geoid map from a database on first use, which Room
  // refuses on the main thread. One thread keeps the fixes in arrival order.
  private val worker = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  /** The fix's height above mean sea level, or null when it has none. */
  fun of(location: Location): Double? =
    if (location.hasAltitude() && LocationCompat.hasMslAltitude(location)) {
      LocationCompat.getMslAltitudeMeters(location)
    } else {
      null
    }

  /** Adds sea-level altitude to [locations] off the main thread, then hands them to [then] on it. */
  fun add(context: Context, locations: List<Location>, then: (List<Location>) -> Unit) {
    val appContext = context.applicationContext
    worker.execute {
      for (location in locations) convert(appContext, location)
      main.post { then(locations) }
    }
  }

  private fun convert(context: Context, location: Location) {
    if (!location.hasAltitude() || LocationCompat.hasMslAltitude(location)) return
    try {
      AltitudeConverterCompat.addMslAltitudeToLocation(context, location)
    } catch (e: Exception) {
      // A fix the converter refuses keeps its position and loses only its altitude.
      Log.w(TAG, "No sea-level altitude for a fix", e)
    }
  }
}
