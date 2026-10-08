package com.veloq

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetRefreshDecisionTest {
  private val ready = PushCredential.Stored.Ready(PushCredential("oauth", "token", "rider"))

  @Test
  fun only_a_signed_in_idle_widget_queues_a_refresh() {
    assertTrue(WidgetRefreshDecision.canQueue(ready, false))
    assertFalse(WidgetRefreshDecision.canQueue(ready, true))
    assertFalse(WidgetRefreshDecision.canQueue(PushCredential.Stored.SignedOut, false))
    assertFalse(WidgetRefreshDecision.canQueue(PushCredential.Stored.Unreadable, false))
  }

  @Test
  fun no_native_result_keeps_the_existing_file() {
    assertNull(WidgetRefreshDecision.snapshot(null))
    assertNull(WidgetRefreshDecision.snapshot("not json"))
    assertNull(WidgetRefreshDecision.snapshot("""{"status":"failed"}"""))
  }

  @Test
  fun a_failed_pull_writes_the_stored_rows_with_their_existing_age() {
    val result = WidgetRefreshDecision.snapshot(
      """{"status":"failed","snapshot":{"generatedAt":1700000000,"metrics":{"form":12}}}""")
    assertEquals(1700000000L, org.json.JSONObject(result!!).getLong("generatedAt"))
    assertEquals(12, org.json.JSONObject(result).getJSONObject("metrics").getInt("form"))
  }
}
