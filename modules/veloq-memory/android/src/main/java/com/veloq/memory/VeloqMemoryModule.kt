package com.veloq.memory

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import com.facebook.drawee.backends.pipeline.Fresco
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Forwards `ComponentCallbacks2.onTrimMemory` to JavaScript unchanged. The last level the
 * system sends is the only warning before the low-memory killer runs: `TRIM_MEMORY_COMPLETE`
 * below API 34, `TRIM_MEMORY_BACKGROUND` from 34, which sends neither `MODERATE`, `COMPLETE`
 * nor `onLowMemory`. JavaScript decides which is the last. React Native routes trim levels
 * to Fresco alone, so nothing else in the app hears them.
 * The callbacks are registered on the application context, which outlives the activity.
 */
class VeloqMemoryModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val trimCallbacks = CallbackRegistration<ComponentCallbacks2>()

  override fun definition() = ModuleDefinition {
    Name("VeloqMemory")

    Events("onTrimMemory")

    // React Native clears Fresco's bitmaps only when the last activity is destroyed.
    Function("clearImageCache") {
      if (Fresco.hasBeenInitialized()) Fresco.getImagePipeline().clearMemoryCaches()
    }

    // The core Image component caches fetched photos, the athlete's profile photo
    // among them, in Fresco's disk caches.
    Function("clearImageDiskCache") {
      if (Fresco.hasBeenInitialized()) Fresco.getImagePipeline().clearDiskCaches()
    }

    OnStartObserving("onTrimMemory") {
      trimCallbacks.register(::applicationCallbacks) {
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
      }
    }

    OnStopObserving("onTrimMemory") { trimCallbacks.unregister() }

    OnDestroy { trimCallbacks.unregister() }
  }

  private fun applicationCallbacks(): CallbackHost<ComponentCallbacks2> {
    val application = context.applicationContext
    return object : CallbackHost<ComponentCallbacks2> {
      override fun register(callback: ComponentCallbacks2) =
        application.registerComponentCallbacks(callback)

      override fun unregister(callback: ComponentCallbacks2) =
        application.unregisterComponentCallbacks(callback)
    }
  }
}
