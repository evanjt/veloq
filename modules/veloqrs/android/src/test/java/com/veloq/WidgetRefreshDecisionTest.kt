package com.veloq

import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OutOfQuotaPolicy
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

  @Test
  fun a_placed_widget_keeps_one_periodic_refresh_without_resetting_its_clock() {
    assertEquals(ExistingPeriodicWorkPolicy.KEEP, WidgetRefreshDecision.periodic(true, 1))
    assertEquals(ExistingPeriodicWorkPolicy.KEEP, WidgetRefreshDecision.periodic(true, 4))
  }

  @Test
  fun signing_out_or_removing_the_last_widget_cancels_the_periodic_refresh() {
    assertNull(WidgetRefreshDecision.periodic(false, 2))
    assertNull(WidgetRefreshDecision.periodic(true, 0))
    assertNull(WidgetRefreshDecision.periodic(false, 0))
  }

  @Test
  fun a_tap_runs_as_expedited_work_where_the_os_allows_it() {
    val expedited = WidgetRefreshDecision.tapRequest(android.os.Build.VERSION_CODES.S).workSpec
    assertTrue(expedited.expedited)
    assertEquals(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST, expedited.outOfQuotaPolicy)
    assertFalse(WidgetRefreshDecision.tapRequest(android.os.Build.VERSION_CODES.R).workSpec.expedited)
  }
}
