package com.veloq

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: a cold worker has the three secure-store values and has to pick
 * the method the way `AuthStore.initialize` does.
 *
 * Expected behaviour: an access token is `oauth` and wins over an API key,
 * an API key alone is `api_key`, and either without an athlete id is nothing.
 */
class PushCredentialTest {
  @Test
  fun an_access_token_is_oauth_and_wins_over_an_api_key() {
    assertEquals(
      PushCredential("oauth", "tok", "i1"),
      PushCredential.choose(accessToken = " tok ", apiKey = "key", athleteId = "i1")
    )
  }

  @Test
  fun an_api_key_alone_is_api_key() {
    assertEquals(
      PushCredential("api_key", "key", "i1"),
      PushCredential.choose(accessToken = null, apiKey = "key", athleteId = "i1")
    )
    assertEquals(
      PushCredential("api_key", "key", "i1"),
      PushCredential.choose(accessToken = "  ", apiKey = "key", athleteId = "i1")
    )
  }

  @Test
  fun nothing_without_an_athlete_or_without_a_secret() {
    assertNull(PushCredential.choose(accessToken = "tok", apiKey = "key", athleteId = null))
    assertNull(PushCredential.choose(accessToken = "tok", apiKey = "key", athleteId = ""))
    assertNull(PushCredential.choose(accessToken = null, apiKey = null, athleteId = "i1"))
  }
}
