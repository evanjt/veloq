package com.veloq.debugcrash

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DebugCrashReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    DebugCrashRequest.set(context.applicationContext)
  }
}
