package __PKG__.widget

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * When the numbers on a snapshot count as old.
 *
 * Past [STALE_AFTER_SECONDS] the age line turns amber and names the time the snapshot was
 * written instead of counting up from it, so a widget the app has not refreshed for a day cannot
 * read as current. The same limit is `SnapshotAge.staleAfter` on iOS.
 */
object SnapshotAge {
  const val STALE_AFTER_SECONDS = 24L * 60L * 60L

  /** Past the limit, strictly. A snapshot with no write time, or one from the future, is not stale. */
  fun isStale(generatedAtSeconds: Long, nowMillis: Long): Boolean =
    generatedAtSeconds > 0L && nowMillis / 1000L - generatedAtSeconds > STALE_AFTER_SECONDS

  /** The write time as a short date and time in the reader's zone and locale. */
  fun absolute(generatedAtSeconds: Long, zone: ZoneId, locale: Locale): String =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT)
      .withLocale(locale)
      .withZone(zone)
      .format(Instant.ofEpochSecond(generatedAtSeconds))
}
