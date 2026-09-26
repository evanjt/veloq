package com.veloq

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Takes the push before Expo does.
 *
 * Expo registers its service at priority -1 for exactly this, so a subclass
 * at the default priority is the one FCM resolves. An activity event goes to
 * the worker and never to `super`: the JavaScript task would otherwise ingest
 * the same ride a second time and post a second entry for it. Everything
 * else, a wellness or fitness event or a wake with no event, is Expo's as
 * before, and so is the token, which the parent forwards.
 */
class VeloqMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val activityId = ActivityPushEvent.activityIdOf(remoteMessage.data)
    if (activityId == null) {
      super.onMessageReceived(remoteMessage)
      return
    }
    ActivityPushWorker.enqueue(applicationContext, activityId)
  }
}
