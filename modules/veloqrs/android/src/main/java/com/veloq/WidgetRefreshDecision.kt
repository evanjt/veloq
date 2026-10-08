package com.veloq

import org.json.JSONObject

/** Decisions shared by a tap and the worker that answers it. */
internal object WidgetRefreshDecision {
  fun canQueue(credential: PushCredential.Stored, busy: Boolean): Boolean =
    credential is PushCredential.Stored.Ready && !busy

  /** Null is a request to leave the last good file untouched. */
  fun snapshot(response: String?): String? = try {
    response?.let { JSONObject(it).optJSONObject("snapshot")?.toString() }
  } catch (_: Exception) {
    null
  }
}
