package com.veloq.focus

import android.content.Context
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * A container whose descendants never take keyboard focus, while touch still reaches them.
 *
 * React Native's switch is a `SwitchCompat`, focusable by default, and its view manager takes no
 * `focusable` prop, so a switch drawn inside a row that is already the control would be a second
 * Tab stop drawing no focus indication. Blocking descendant focus here leaves the row as the one
 * stop. Accessibility focus is separate and stays with the props the caller sets.
 */
class KeyboardFocusBlockView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  init {
    isFocusable = false
    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
  }
}
