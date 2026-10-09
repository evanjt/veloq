package com.veloq.recording

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Tells the rider at process start that a ride stopped. Expo autolinking finds a package by a file
 * named `*Package.kt` that imports [Package], so this keeps both.
 */
class VeloqRecordingNotificationPackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context
  ): List<ApplicationLifecycleListener> = listOf(InterruptedRideAtStart)
}

private object InterruptedRideAtStart : ApplicationLifecycleListener {
  override fun onCreate(application: Application) {
    InterruptedRideNotifier.postIfInterrupted(application)
  }
}
