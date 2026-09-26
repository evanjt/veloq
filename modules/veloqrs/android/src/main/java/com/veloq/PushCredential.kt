package com.veloq

import android.content.Context

/**
 * The intervals.icu credential a cold-started worker hands to Rust.
 *
 * The three entries are `AuthStore`'s, under the keys it writes, and the
 * method is chosen the way `AuthStore.initialize` chooses it: an access token
 * wins over an API key, and either without an athlete id is nothing.
 */
data class PushCredential(val method: String, val secret: String, val athleteId: String) {
  companion object {
    private const val API_KEY = "intervals_api_key"
    private const val ACCESS_TOKEN = "intervals_access_token"
    private const val ATHLETE_ID = "intervals_athlete_id"

    /** The credential the store holds, or null when the athlete is signed out. */
    @JvmStatic
    fun read(context: Context): PushCredential? = choose(
      accessToken = SecureStoreReader.read(context, ACCESS_TOKEN),
      apiKey = SecureStoreReader.read(context, API_KEY),
      athleteId = SecureStoreReader.read(context, ATHLETE_ID)
    )

    /** `AuthStore.initialize`'s choice, as a function of the three values. */
    @JvmStatic
    fun choose(accessToken: String?, apiKey: String?, athleteId: String?): PushCredential? {
      val athlete = athleteId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
      accessToken?.trim()?.takeIf { it.isNotEmpty() }?.let {
        return PushCredential("oauth", it, athlete)
      }
      apiKey?.trim()?.takeIf { it.isNotEmpty() }?.let {
        return PushCredential("api_key", it, athlete)
      }
      return null
    }
  }
}
