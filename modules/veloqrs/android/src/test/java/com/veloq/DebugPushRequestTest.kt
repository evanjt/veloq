package com.veloq

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DebugPushRequestTest {
  @Test
  fun test_from_ids_accepts_both_nonempty_ids() {
    assertEquals(
      DebugPushRequest("ride-123", "athlete-456"),
      DebugPushRequest.fromIds("ride-123", "athlete-456")
    )
  }

  @Test
  fun test_from_ids_rejects_missing_or_blank_ids() {
    assertNull(DebugPushRequest.fromIds(null, "athlete-456"))
    assertNull(DebugPushRequest.fromIds("ride-123", null))
    assertNull(DebugPushRequest.fromIds(" ", "athlete-456"))
    assertNull(DebugPushRequest.fromIds("ride-123", " "))
  }
}
