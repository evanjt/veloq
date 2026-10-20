package com.veloq.widget

import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the widget's age line counts up from when the snapshot was written, so an athlete whose
 * app has not run for a day reads "1 day ago" in the same grey as a fresh one.
 *
 * Expected behaviour: past 24 hours the line is stale and names the time it was written, at or
 * under 24 hours it counts up, and a snapshot with no write time says nothing.
 */
class SnapshotAgeTest {
  private val written = 1_791_300_000L

  private fun nowAfter(hours: Long, seconds: Long = 0L): Long =
    (written + hours * 3600L + seconds) * 1000L

  @Test
  fun a_snapshot_25_hours_old_is_stale() {
    assertTrue(SnapshotAge.isStale(written, nowAfter(25)))
  }

  @Test
  fun a_snapshot_exactly_24_hours_old_is_not_yet_stale() {
    assertFalse(SnapshotAge.isStale(written, nowAfter(24)))
  }

  @Test
  fun a_snapshot_one_second_past_24_hours_is_stale() {
    assertTrue(SnapshotAge.isStale(written, nowAfter(24, 1)))
  }

  @Test
  fun a_fresh_snapshot_is_not_stale() {
    assertFalse(SnapshotAge.isStale(written, nowAfter(0)))
    assertFalse(SnapshotAge.isStale(written, nowAfter(23)))
  }

  @Test
  fun a_snapshot_with_no_write_time_is_never_stale() {
    assertFalse(SnapshotAge.isStale(0L, nowAfter(500)))
  }

  @Test
  fun a_snapshot_from_the_future_is_not_stale() {
    assertFalse(SnapshotAge.isStale(written, nowAfter(-3)))
  }

  @Test
  fun the_stale_line_names_the_time_in_the_zone_and_locale_it_is_read_in() {
    val label = SnapshotAge.absolute(written, ZoneId.of("UTC"), Locale.GERMANY)
    assertTrue(label, label.contains("15:20"))
    val shifted = SnapshotAge.absolute(written, ZoneId.of("Asia/Tokyo"), Locale.GERMANY)
    assertTrue(shifted, shifted.contains("00:20"))
  }

  @Test
  fun the_age_line_speaks_the_language_the_snapshot_was_written_in() {
    assertEquals(Locale.forLanguageTag("de-CH"), SnapshotAge.locale("de-CH", Locale.UK))
    assertEquals(Locale.forLanguageTag("zh-Hans"), SnapshotAge.locale("zh-Hans", Locale.UK))
  }

  @Test
  fun a_snapshot_with_no_language_reads_in_the_phone_language() {
    assertEquals(Locale.UK, SnapshotAge.locale("", Locale.UK))
    assertEquals(Locale.UK, SnapshotAge.locale(null, Locale.UK))
    assertEquals(Locale.UK, SnapshotAge.locale("!!", Locale.UK))
  }

  @Test
  fun under_a_minute_the_age_reads_as_now_rather_than_zero_minutes() {
    assertEquals(SnapshotAge.Span(0L, SnapshotAge.AgeUnit.NOW), SnapshotAge.span(written, written * 1000L))
    assertEquals(
      SnapshotAge.Span(0L, SnapshotAge.AgeUnit.NOW), SnapshotAge.span(written, written * 1000L + 59_999L))
  }

  @Test
  fun the_age_counts_whole_minutes_from_a_minute_to_an_hour() {
    assertEquals(SnapshotAge.Span(1L, SnapshotAge.AgeUnit.MINUTES), SnapshotAge.span(written, nowAfter(0, 60L)))
    assertEquals(
      SnapshotAge.Span(1L, SnapshotAge.AgeUnit.MINUTES), SnapshotAge.span(written, nowAfter(0, 119L)))
    assertEquals(
      SnapshotAge.Span(5L, SnapshotAge.AgeUnit.MINUTES), SnapshotAge.span(written, nowAfter(0, 5 * 60L)))
    assertEquals(
      SnapshotAge.Span(59L, SnapshotAge.AgeUnit.MINUTES), SnapshotAge.span(written, nowAfter(0, 3599L)))
  }

  @Test
  fun the_age_counts_whole_hours_from_an_hour() {
    assertEquals(SnapshotAge.Span(1L, SnapshotAge.AgeUnit.HOURS), SnapshotAge.span(written, nowAfter(1)))
    assertEquals(SnapshotAge.Span(23L, SnapshotAge.AgeUnit.HOURS), SnapshotAge.span(written, nowAfter(23, 3599L)))
  }

  @Test
  fun a_snapshot_from_the_future_reads_as_just_written() {
    assertEquals(SnapshotAge.Span(0L, SnapshotAge.AgeUnit.NOW), SnapshotAge.span(written, nowAfter(-3)))
  }
}
