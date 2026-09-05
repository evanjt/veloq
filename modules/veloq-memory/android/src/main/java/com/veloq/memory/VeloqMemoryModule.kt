package com.veloq.memory

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import com.facebook.drawee.backends.pipeline.Fresco
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Forwards `ComponentCallbacks2.onTrimMemory` to JavaScript. Android's last level,
 * `TRIM_MEMORY_COMPLETE`, is the only warning before the low-memory killer runs, and
 * React Native routes trim levels to Fresco alone, so nothing else in the app hears them.
 * The callbacks are registered on the application context, which outlives the activity.
 */
class VeloqMemoryModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var callbacks: ComponentCallbacks2? = null

  override fun definition() = ModuleDefinition {
    Name("VeloqMemory")

    Events("onTrimMemory")

    // React Native clears Fresco's bitmaps only when the last activity is destroyed.
    Function("clearImageCache") {
      if (Fresco.hasBeenInitialized()) Fresco.getImagePipeline().clearMemoryCaches()
    }

    OnStartObserving("onTrimMemory") {
      if (callbacks != null) return@OnStartObserving
      val registered =
        object : ComponentCallbacks2 {
          override fun onTrimMemory(level: Int) {
            sendEvent("onTrimMemory", mapOf("level" to level))
          }

          override fun onConfigurationChanged(newConfig: Configuration) = Unit

          @Deprecated("Superseded by onTrimMemory")
          override fun onLowMemory() {
            sendEvent("onTrimMemory", mapOf("level" to ComponentCallbacks2.TRIM_MEMORY_COMPLETE))
          }
        }
      context.applicationContext.registerComponentCallbacks(registered)
      callbacks = registered
    }

    OnStopObserving("onTrimMemory") {
      callbacks?.let { context.applicationContext.unregisterComponentCallbacks(it) }
      callbacks = null
    }

    OnDestroy {
      callbacks?.let { context.applicationContext.unregisterComponentCallbacks(it) }
      callbacks = null
    }
  }
}
