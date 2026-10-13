package com.veloq.locale

import android.app.LocaleManager
import android.content.Context
import android.os.Build
import android.os.LocaleList
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The per-app language Android 13 and later keeps for each app, which the system's App languages
 * page sets and which every native string the app draws follows: widgets, notification channels,
 * the launcher's shortcuts. Below API 33 there is none, and each read answers null.
 *
 * The process locale is the per-app one while it is set, so the phone's own languages are read
 * from the system list rather than from the default locale.
 */
class VeloqLocaleModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun localeManager(): LocaleManager? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.getSystemService(LocaleManager::class.java)
    } else {
      null
    }

  override fun definition() = ModuleDefinition {
    Name("VeloqLocale")

    Function("getApplicationLocales") {
      localeManager()?.applicationLocales?.toLanguageTags()
    }

    Function("getSystemLocales") {
      localeManager()?.systemLocales?.let { list -> (0 until list.size()).map { list[it].toLanguageTag() } }
    }

    Function("setApplicationLocales") { tags: String ->
      localeManager()?.applicationLocales = LocaleList.forLanguageTags(tags)
    }
  }
}
