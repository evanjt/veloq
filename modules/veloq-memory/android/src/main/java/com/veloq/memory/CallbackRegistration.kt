package com.veloq.memory

internal interface CallbackHost<C> {
  fun register(callback: C)

  fun unregister(callback: C)
}

/**
 * Holds one registered callback with the host it was registered on. The host is read once, at
 * registration, and unregistering goes back through that saved host: the getter that supplied it
 * can throw by teardown, and a throw there would leave the callback registered.
 */
internal class CallbackRegistration<C> {
  private var registered: Pair<CallbackHost<C>, C>? = null

  fun register(host: () -> CallbackHost<C>, create: () -> C) {
    if (registered != null) return
    val target = host()
    val callback = create()
    target.register(callback)
    registered = target to callback
  }

  fun unregister() {
    val (host, callback) = registered ?: return
    registered = null
    host.unregister(callback)
  }
}
