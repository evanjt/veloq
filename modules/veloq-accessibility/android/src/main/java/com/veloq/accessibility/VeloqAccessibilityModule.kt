package com.veloq.accessibility

import android.content.Context
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The system's accessibility display settings, read synchronously because the app's styles are
 * built from them when their modules load. A change while the app runs therefore shows at the
 * next launch.
 *
 * Bold text is the font weight adjustment Android 12 and later keeps in the configuration, which
 * React Native's text never applies to a bundled face. Below API 31 there is none, and it reads off.
 *
 * Button shapes is an iOS setting with no Android counterpart, so it always reads off.
 */
class VeloqAccessibilityModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VeloqAccessibility")

    Function("boldText") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        context.resources.configuration.fontWeightAdjustment > 0
    }

    Function("buttonShapes") { false }
  }
}
