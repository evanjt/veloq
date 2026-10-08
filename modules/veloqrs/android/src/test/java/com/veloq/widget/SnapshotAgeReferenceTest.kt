package com.veloq.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: a refresh whose pull did not land redraws the widget from stored rows, so the snapshot
 * is written now while its numbers are as old as the last sync.
 *
 * Expected behaviour: the age line is judged from the sync the numbers came from, never from the
 * redraw, and it goes stale when that sync is a day old however recently the file was written.
 */
class SnapshotAgeReferenceTest {
  private val synced = 1_791_300_000L
  private val redrawn = synced + 2L * 24L * 3600L

  private fun parse(root: JSONObject, display: JSONObject = JSONObject()): WidgetSnapshot =
    WidgetSnapshot.parse(root.put("emptyLibrary", false).put("display", display))

  private fun offline(dataAsOf: Long?): WidgetSnapshot {
    val root = JSONObject().put("generatedAt", redrawn)
    if (dataAsOf != null) root.put("dataAsOf", dataAsOf)
    return parse(root, JSONObject().put("dataAsOfLabel", "As of last sync"))
  }

  @Test
  fun an_offline_redraw_is_judged_from_the_last_sync() {
    val snap = offline(synced)
    assertEquals("As of last sync", snap.dataAsOfLabel)
    assertEquals(synced, SnapshotAge.reference(snap))
  }

  @Test
  fun an_offline_redraw_of_a_day_old_sync_is_stale_though_written_now() {
    val reference = SnapshotAge.reference(offline(synced))!!
    assertTrue(SnapshotAge.isStale(reference, redrawn * 1000L))
  }

  @Test
  fun an_offline_redraw_with_no_recorded_sync_has_no_age() {
    assertNull(SnapshotAge.reference(offline(null)))
    assertNull(SnapshotAge.reference(offline(0L)))
  }

  @Test
  fun a_snapshot_from_a_landed_pull_is_judged_from_when_it_was_written() {
    assertEquals(redrawn, SnapshotAge.reference(parse(JSONObject().put("generatedAt", redrawn))))
  }

  @Test
  fun a_sync_time_without_its_label_is_not_read_as_the_reference() {
    val snap = parse(JSONObject().put("generatedAt", redrawn).put("dataAsOf", synced))
    assertEquals(redrawn, SnapshotAge.reference(snap))
  }

  @Test
  fun a_sample_snapshot_has_no_age() {
    val snap = parse(JSONObject().put("generatedAt", redrawn), JSONObject().put("demoLabel", "Sample"))
    assertNull(SnapshotAge.reference(snap))
  }

  @Test
  fun no_snapshot_and_no_write_time_have_no_age() {
    assertNull(SnapshotAge.reference(null))
    assertNull(SnapshotAge.reference(parse(JSONObject())))
  }
}
