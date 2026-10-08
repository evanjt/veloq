package com.veloq.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: the snapshot was composed from the sample library because nobody is signed in or the
 * app is in demo mode.
 *
 * Expected behaviour: the label the engine wrote is read for the widgets to draw, and a snapshot
 * of a real library, or one written before the field, carries none.
 */
class SampleLibraryLabelTest {
  private fun parse(display: JSONObject): WidgetSnapshot =
    WidgetSnapshot.parse(JSONObject().put("emptyLibrary", false).put("display", display))

  @Test
  fun a_sample_snapshot_carries_its_label() {
    assertEquals("Sample Mode", parse(JSONObject().put("demoLabel", "Sample Mode")).demoLabel)
  }

  @Test
  fun a_real_library_carries_no_label() {
    assertNull(parse(JSONObject()).demoLabel)
  }

  @Test
  fun an_empty_label_is_no_label() {
    assertNull(parse(JSONObject().put("demoLabel", "")).demoLabel)
  }
}
