package com.veloq.display

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Registers the refresh rate request on the main activity. Expo autolinking finds a package by a
 * file named `*Package.kt` that imports [Package], so this keeps both.
 */
class VeloqDisplayPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context
  ): List<ReactActivityLifecycleListener> = listOf(HighestRefreshRate)
}

private object HighestRefreshRate : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    RefreshRate.request(activity)
  }
}
