package com.veloq

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DebugPushReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val request = DebugPushRequest.fromIds(
      intent.getStringExtra("activity_id"),
      intent.getStringExtra("athlete_id")
    ) ?: return
    ActivityPushWorker.enqueue(context.applicationContext, request.activityId, request.athleteId)
  }
}
