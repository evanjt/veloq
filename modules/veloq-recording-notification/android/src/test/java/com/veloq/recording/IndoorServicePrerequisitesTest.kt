package com.veloq.recording

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: an indoor ride starts on a phone where the rider has not granted Bluetooth access.
 *
 * Expected behaviour: from Android 14 the connected-device service is not started, because its
 * `startForeground` would throw and the unfulfilled start would take the process down. Before 14
 * nothing is checked and the service starts.
 */
class IndoorServicePrerequisitesTest {
  @Test
  fun android_14_without_bluetooth_access_does_not_start_the_service() {
    assertFalse(IndoorServicePrerequisites.met(34, bluetoothConnectGranted = false))
    assertFalse(IndoorServicePrerequisites.met(36, bluetoothConnectGranted = false))
  }

  @Test
  fun android_14_with_bluetooth_access_starts_it() {
    assertTrue(IndoorServicePrerequisites.met(34, bluetoothConnectGranted = true))
  }

  @Test
  fun android_13_checks_nothing() {
    assertTrue(IndoorServicePrerequisites.met(33, bluetoothConnectGranted = false))
  }
}
