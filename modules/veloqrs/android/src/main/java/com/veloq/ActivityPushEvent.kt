package com.veloq

import org.json.JSONObject

/**
 * Which pushes the native service takes for itself.
 *
 * The worker at `auth.veloq.fit` sends `{ event_type, athlete_id, activity_id }`,
 * and Expo hands it to FCM as the `body` key holding that object as a JSON
 * string, or flat when the wrapping is dropped. The visible push carries the
 * same fields beside its tap data. So one reading covers every message: an
 * activity event names the activity, anything else is somebody else's.
 */
object ActivityPushEvent {
  private val ACTIVITY_EVENTS = setOf("ACTIVITY_UPLOADED", "ACTIVITY_ANALYZED")

  /**
   * The activity id when this push is an activity event, or null when it is
   * not: a wellness or fitness event, a wake with no event type, or a body
   * that will not parse.
   */
  @JvmStatic
  fun activityIdOf(data: Map<String, String>): String? {
    val fields = data["body"]?.let(::parse) ?: data
    val event = fields["event_type"] ?: return null
    if (event !in ACTIVITY_EVENTS) return null
    return fields["activity_id"]?.takeIf { it.isNotEmpty() }
  }

  private fun parse(body: String): Map<String, String>? {
    val json = try {
      JSONObject(body)
    } catch (e: Exception) {
      return null
    }
    val fields = HashMap<String, String>()
    for (key in json.keys()) {
      val value = json.opt(key) ?: continue
      // The worker sends the id as a string, and a number is the same id.
      if (value is String || value is Number) fields[key] = value.toString()
    }
    return fields
  }
}
