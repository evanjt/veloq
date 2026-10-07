package com.veloq

import org.json.JSONObject

internal object ActivityPushResponse {
  data class Decision(val notification: JSONObject?, val failureReason: String?) {
    /**
     * Rust answered with an entry, so the run got past the gate and whatever it
     * stored is in the database the widget is composed from. A refusal stored
     * nothing, and a call that failed outright has nothing to say about it.
     */
    val refreshesWidget: Boolean
      get() = notification != null && failureReason == null
  }

  sealed class Gate {
    /** Nothing is posted: the device is signed out, or the push is another athlete's. */
    object Silent : Gate()
    /** A stored entry gave no credential, so the plain entry is posted and the failure recorded. */
    object Unreadable : Gate()
    data class Ready(val credential: PushCredential) : Gate()
  }

  fun gate(stored: PushCredential.Stored, pushAthleteId: String): Gate = when (stored) {
    PushCredential.Stored.SignedOut -> Gate.Silent
    PushCredential.Stored.Unreadable -> Gate.Unreadable
    is PushCredential.Stored.Ready ->
      if (stored.credential.athleteId == pushAthleteId.trim()) Gate.Ready(stored.credential) else Gate.Silent
  }

  fun resolve(
    json: String?,
    unavailableReason: String?,
    fallback: () -> String?,
    recordFailure: (String) -> Unit = {}
  ): Decision {
    if (unavailableReason == null && json != null) {
      val answer = runCatching { JSONObject(json) }.getOrNull()
      if (answer?.optBoolean("skip") == true) return Decision(null, null)
      if (answer?.optString("title")?.isNotEmpty() == true) return Decision(answer, null)
    }
    val reason = unavailableReason ?: if (json == null) "native answer missing" else "native answer malformed"
    recordFailure(reason)
    val notification = fallback()?.let { runCatching { JSONObject(it) }.getOrNull() }
    return Decision(notification, reason)
  }
}
