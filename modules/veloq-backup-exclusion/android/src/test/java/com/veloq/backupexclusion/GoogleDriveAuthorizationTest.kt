package com.veloq.backupexclusion

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Scenario: Play services refuses a Google Drive authorisation with a status code.
 *
 * Expected behaviour: a refusal that needs the athlete to sign in again, and a dismissed picker,
 * each reach the bridge as their own code, since a run reports the first as a failure to act on
 * and a sign-in treats the second as no change. Every other status is a plain failure.
 */
class GoogleDriveAuthorizationTest {
  @Test
  fun a_missing_grant_asks_for_a_sign_in() {
    assertEquals(GoogleDriveAuthorization.SIGN_IN_NEEDED, GoogleDriveAuthorization.refusalCode(4))
  }

  @Test
  fun a_dismissed_picker_is_a_cancel() {
    assertEquals(GoogleDriveAuthorization.SIGN_IN_CANCELLED, GoogleDriveAuthorization.refusalCode(16))
  }

  @Test
  fun a_build_google_does_not_know_and_a_dead_network_are_plain_failures() {
    assertEquals(GoogleDriveAuthorization.AUTHORIZATION_FAILED, GoogleDriveAuthorization.refusalCode(10))
    assertEquals(GoogleDriveAuthorization.AUTHORIZATION_FAILED, GoogleDriveAuthorization.refusalCode(7))
    assertEquals(GoogleDriveAuthorization.AUTHORIZATION_FAILED, GoogleDriveAuthorization.refusalCode(null))
  }
}
