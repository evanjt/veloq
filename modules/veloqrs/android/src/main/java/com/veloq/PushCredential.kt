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
  sealed class Stored {
    object SignedOut : Stored()
    object Unreadable : Stored()
    data class Ready(val credential: PushCredential) : Stored()
  }

  companion object {
    private const val API_KEY = "intervals_api_key"
    private const val ACCESS_TOKEN = "intervals_access_token"
    private const val ATHLETE_ID = "intervals_athlete_id"

    /**
     * What the store holds: the credential, nothing because the athlete signed
     * out (sign-out deletes the athlete id entry), or an entry that is there
     * and gave no credential.
     */
    @JvmStatic
    fun read(context: Context): Stored = classify(
      accessToken = SecureStoreReader.read(context, ACCESS_TOKEN),
      apiKey = SecureStoreReader.read(context, API_KEY),
      athleteId = SecureStoreReader.read(context, ATHLETE_ID),
      athleteStored = SecureStoreReader.isStored(context, ATHLETE_ID)
    )

    /** `choose` told apart by whether an athlete id envelope exists at all. */
    @JvmStatic
    fun classify(
      accessToken: String?,
      apiKey: String?,
      athleteId: String?,
      athleteStored: Boolean
    ): Stored {
      if (!athleteStored) return Stored.SignedOut
      val credential = choose(accessToken, apiKey, athleteId) ?: return Stored.Unreadable
      return Stored.Ready(credential)
    }

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
