package com.veloq

internal data class DebugPushRequest(val activityId: String, val athleteId: String) {
  companion object {
    fun fromIds(activityId: String?, athleteId: String?): DebugPushRequest? {
      val activity = activityId?.takeIf { it.isNotBlank() } ?: return null
      val athlete = athleteId?.takeIf { it.isNotBlank() } ?: return null
      return DebugPushRequest(activity, athlete)
    }
  }
}
