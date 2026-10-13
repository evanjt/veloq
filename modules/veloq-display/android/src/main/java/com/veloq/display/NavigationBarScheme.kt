package com.veloq.display

import android.app.Activity
import android.content.res.Configuration
import android.os.Build
import androidx.core.content.OnConfigurationChangedProvider
import androidx.core.util.Consumer
import androidx.core.view.WindowInsetsControllerCompat

/** What the navigation bar draws: dark icons for a light scheme, and a colour where one is set. */
data class NavigationBarAppearance(val lightIcons: Boolean, val color: Int?)

/**
 * React Native's edge-to-edge setup decides the navigation bar once, in `onCreate`. The activity
 * handles `uiMode` itself, so a scheme applied later, by the app's own preference or by the
 * system, reaches it as a configuration change and never as a new activity. The bar is decided
 * again from each configuration, the same way edge-to-edge decides it for that scheme.
 */
object NavigationBarScheme {
  /** The platform's light scrim, which edge-to-edge sets below API 29 for a light scheme. */
  const val LIGHT_BAR: Int = 0xE6FFFFFF.toInt()

  /** The platform's dark scrim, which edge-to-edge sets below API 29 for a dark scheme. */
  const val DARK_BAR: Int = 0x801B1B1B.toInt()

  /** The bar for a configuration's `uiMode` on an SDK level. From API 29 the colour stays. */
  fun appearance(uiMode: Int, sdk: Int): NavigationBarAppearance {
    val dark = (uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val lightBarAvailable = sdk >= Build.VERSION_CODES.O
    val color =
      when {
        sdk >= Build.VERSION_CODES.Q -> null
        lightBarAvailable && !dark -> LIGHT_BAR
        else -> DARK_BAR
      }
    return NavigationBarAppearance(lightIcons = lightBarAvailable && !dark, color = color)
  }

  @Suppress("DEPRECATION")
  fun apply(activity: Activity, configuration: Configuration) {
    val window = activity.window ?: return
    val appearance = appearance(configuration.uiMode, Build.VERSION.SDK_INT)
    appearance.color?.let { window.navigationBarColor = it }
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars =
      appearance.lightIcons
  }

  /** Applies the bar now and on every configuration change, until [unfollow]. */
  fun follow(activity: Activity) {
    apply(activity, activity.resources.configuration)
    val provider = activity as? OnConfigurationChangedProvider ?: return
    unfollow(activity)
    val listener = Consumer<Configuration> { apply(activity, it) }
    provider.addOnConfigurationChangedListener(listener)
    listeners[activity] = listener
  }

  fun unfollow(activity: Activity) {
    val listener = listeners.remove(activity) ?: return
    (activity as? OnConfigurationChangedProvider)?.removeOnConfigurationChangedListener(listener)
  }

  private val listeners = HashMap<Activity, Consumer<Configuration>>()
}
