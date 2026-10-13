package com.veloq.memory

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the module registers its trim callback while the React context is alive, and the
 * context is gone by the time the module stops observing or is destroyed.
 *
 * Expected behaviour: unregistering removes the callback from the host it was registered on and
 * never asks for the host again, so a lost context cannot throw out of teardown.
 */
class CallbackRegistrationTest {
  private class Application : CallbackHost<String> {
    val registered = mutableListOf<String>()

    override fun register(callback: String) {
      registered += callback
    }

    override fun unregister(callback: String) {
      registered -= callback
    }
  }

  private class ContextLost : RuntimeException()

  private class Provider(private val application: Application) {
    var alive = true
    var reads = 0

    fun host(): CallbackHost<String> {
      reads++
      if (!alive) throw ContextLost()
      return application
    }
  }

  @Test
  fun unregistering_after_the_context_is_lost_removes_the_callback() {
    val application = Application()
    val provider = Provider(application)
    val registration = CallbackRegistration<String>()

    registration.register(provider::host) { "trim" }
    provider.alive = false
    registration.unregister()

    assertTrue(application.registered.isEmpty())
  }

  @Test
  fun a_second_register_keeps_the_one_callback() {
    val application = Application()
    val provider = Provider(application)
    val registration = CallbackRegistration<String>()

    registration.register(provider::host) { "trim" }
    registration.register(provider::host) { "duplicate" }

    assertEquals(listOf("trim"), application.registered)
    assertEquals(1, provider.reads)
  }

  @Test
  fun unregistering_twice_or_before_registering_does_nothing() {
    val application = Application()
    val provider = Provider(application)
    val registration = CallbackRegistration<String>()

    registration.unregister()
    registration.register(provider::host) { "trim" }
    registration.unregister()
    registration.unregister()

    assertTrue(application.registered.isEmpty())
    assertEquals(1, provider.reads)
  }

  @Test
  fun registering_again_after_unregistering_reads_the_current_host() {
    val first = Application()
    val second = Application()
    var current = first
    val registration = CallbackRegistration<String>()

    registration.register({ current }) { "trim" }
    registration.unregister()
    current = second
    registration.register({ current }) { "trim" }

    assertTrue(first.registered.isEmpty())
    assertEquals(listOf("trim"), second.registered)
  }

  @Test
  fun a_host_that_cannot_be_read_registers_nothing() {
    val application = Application()
    val provider = Provider(application)
    provider.alive = false
    val registration = CallbackRegistration<String>()

    runCatching { registration.register(provider::host) { "trim" } }
    provider.alive = true
    registration.register(provider::host) { "trim" }

    assertEquals(listOf("trim"), application.registered)
  }
}
