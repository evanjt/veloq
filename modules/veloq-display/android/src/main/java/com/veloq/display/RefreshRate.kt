package com.veloq.display

import android.app.Activity
import android.os.Build
import android.view.Display

/** The part of a [Display.Mode] the choice reads, so the choice runs without a device. */
data class DisplayModeSpec(val id: Int, val width: Int, val height: Int, val refreshRate: Float)

/**
 * Android pins a window to 60 Hz unless the app votes higher, so a 120 Hz panel on an OEM that
 * does not raise the rate itself renders at 60. The vote is for the fastest mode at the current
 * resolution, so it never switches the panel's resolution.
 */
object RefreshRate {
  /** The mode to ask for, or null when the window is already in it or nothing is faster. */
  fun preferredModeId(current: DisplayModeSpec, supported: List<DisplayModeSpec>): Int? {
    val best =
      supported
        .filter { it.width == current.width && it.height == current.height }
        .maxByOrNull { it.refreshRate } ?: return null
    return if (best.id == current.id) null else best.id
  }

  fun request(activity: Activity) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    val display =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display
      else @Suppress("DEPRECATION") activity.windowManager.defaultDisplay
    val current = display?.mode ?: return
    val preferred =
      preferredModeId(spec(current), display.supportedModes.map(::spec)) ?: return
    val window = activity.window
    window.attributes = window.attributes.apply { preferredDisplayModeId = preferred }
  }

  private fun spec(mode: Display.Mode) =
    DisplayModeSpec(mode.modeId, mode.physicalWidth, mode.physicalHeight, mode.refreshRate)
}
