package com.veloq.recording

/**
 * Decides whether a notification button press reached JavaScript. An event sent while nothing
 * subscribes is dropped without an error, so the module being alive does not mean a press was
 * taken: it counts as delivered only while a subscriber is attached, and the receiver queues the
 * rest.
 */
internal class ActionRoute(private val send: (action: String, session: Long) -> Unit) {
  @Volatile private var observing = false

  fun startObserving() {
    observing = true
  }

  fun stopObserving() {
    observing = false
  }

  /** True when a subscriber was attached and the press was sent to it. */
  fun dispatch(action: String, session: Long): Boolean {
    if (!observing) return false
    return try {
      send(action, session)
      true
    } catch (e: Exception) {
      false
    }
  }
}
