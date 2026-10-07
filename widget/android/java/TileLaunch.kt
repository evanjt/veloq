package __PKG__.widget

import android.os.Build

/**
 * How the Quick Settings tile starts the app. The Intent overload of
 * `startActivityAndCollapse` throws on 34 and later for an app targeting 34 or
 * later, and the PendingIntent overload only exists from 34. Both unlock first.
 */
object TileLaunch {
  fun takesPendingIntent(sdk: Int): Boolean = sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
}
