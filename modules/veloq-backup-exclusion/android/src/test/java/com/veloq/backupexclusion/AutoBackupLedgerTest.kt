package com.veloq.backupexclusion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * Scenario: Android runs Auto Backup in the background and tells the app only through its
 * backup agent. Every run calls `onFullBackup` once to measure the payload, and again to send
 * it only when it fits; a payload over the quota gets `onQuotaExceeded` instead of the second
 * call.
 *
 * Expected behaviour: the record keeps the last backup Android took, a quota overrun with both
 * of its numbers, and a restore, and an overrun never leaves its own measuring call standing as
 * a backup.
 */
class AutoBackupLedgerTest {
  private class MapStore : AutoBackupLedger.Store {
    val values = mutableMapOf<String, Long>()

    override fun read(key: String): Long? = values[key]

    override fun write(changes: Map<String, Long?>) {
      for ((key, value) in changes) {
        if (value == null) values.remove(key) else values[key] = value
      }
    }
  }

  private val store = MapStore()
  private val ledger = AutoBackupLedger(store)

  /** A run that fits: measured, then sent. */
  private fun backedUp(at: Long, bytes: Long) {
    ledger.recordBackup(at, bytes)
    ledger.recordBackup(at, bytes)
  }

  @Test
  fun a_phone_android_never_backed_up_has_nothing_recorded() {
    val status = ledger.status()

    assertNull(status.backedUpAt)
    assertNull(status.backedUpBytes)
    assertNull(status.quotaExceededAt)
    assertNull(status.restoredAt)
  }

  @Test
  fun a_backup_records_its_time_and_size() {
    backedUp(1_000L, 4_096L)

    val status = ledger.status()
    assertEquals(1_000L, status.backedUpAt)
    assertEquals(4_096L, status.backedUpBytes)
  }

  @Test
  fun a_quota_overrun_records_both_numbers_and_its_time() {
    ledger.recordQuotaExceeded(2_000L, 30_000_000L, 25_000_000L)

    val status = ledger.status()
    assertEquals(2_000L, status.quotaExceededAt)
    assertEquals(30_000_000L, status.quotaExceededBytes)
    assertEquals(25_000_000L, status.quotaBytes)
  }

  @Test
  fun an_overrun_keeps_the_last_backup_that_went_rather_than_its_own_measuring_call() {
    backedUp(1_000L, 4_096L)

    ledger.recordBackup(2_000L, 30_000_000L)
    ledger.recordQuotaExceeded(2_000L, 30_000_000L, 25_000_000L)

    val status = ledger.status()
    assertEquals(1_000L, status.backedUpAt)
    assertEquals(4_096L, status.backedUpBytes)
    assertEquals(2_000L, status.quotaExceededAt)
  }

  @Test
  fun a_second_overrun_in_a_row_still_keeps_the_last_backup_that_went() {
    backedUp(1_000L, 4_096L)
    ledger.recordBackup(2_000L, 30_000_000L)
    ledger.recordQuotaExceeded(2_000L, 30_000_000L, 25_000_000L)

    ledger.recordBackup(3_000L, 31_000_000L)
    ledger.recordQuotaExceeded(3_000L, 31_000_000L, 25_000_000L)

    val status = ledger.status()
    assertEquals(1_000L, status.backedUpAt)
    assertEquals(4_096L, status.backedUpBytes)
    assertEquals(3_000L, status.quotaExceededAt)
    assertEquals(31_000_000L, status.quotaExceededBytes)
  }

  @Test
  fun an_overrun_before_any_backup_leaves_none_recorded() {
    ledger.recordBackup(2_000L, 30_000_000L)
    ledger.recordQuotaExceeded(2_000L, 30_000_000L, 25_000_000L)

    val status = ledger.status()
    assertNull(status.backedUpAt)
    assertNull(status.backedUpBytes)
  }

  @Test
  fun a_backup_after_an_overrun_is_the_last_backup() {
    ledger.recordBackup(2_000L, 30_000_000L)
    ledger.recordQuotaExceeded(2_000L, 30_000_000L, 25_000_000L)

    backedUp(3_000L, 4_096L)

    val status = ledger.status()
    assertEquals(3_000L, status.backedUpAt)
    assertEquals(2_000L, status.quotaExceededAt)
  }

  @Test
  fun a_restore_records_its_time_and_leaves_the_backup_alone() {
    backedUp(1_000L, 4_096L)

    ledger.recordRestore(5_000L)

    val status = ledger.status()
    assertEquals(5_000L, status.restoredAt)
    assertEquals(1_000L, status.backedUpAt)
  }

  @Test
  fun the_record_survives_a_new_ledger_over_the_same_store() {
    backedUp(1_000L, 4_096L)
    ledger.recordRestore(5_000L)

    val status = AutoBackupLedger(store).status()
    assertEquals(1_000L, status.backedUpAt)
    assertEquals(5_000L, status.restoredAt)
  }
}

/**
 * Scenario: the platform hands the agent no payload size, so the agent adds up the files its
 * backup rules carry, which is the latest record zip alone.
 *
 * Expected behaviour: the sum counts the zip and no preferences file, and a phone with no zip
 * yet counts nothing rather than failing.
 */
class BackupPayloadTest {
  @get:Rule val dir = TemporaryFolder()

  private fun write(relative: String, bytes: Int) {
    val file = File(dir.root, relative)
    file.parentFile?.mkdirs()
    file.writeBytes(ByteArray(bytes))
  }

  @Test
  fun counts_the_record_zip_and_no_preferences() {
    write("files/veloq-decisions.zip", 4_000)
    write("shared_prefs/TaskManagerModule.xml", 500)

    assertEquals(4_000L, BackupPayload.bytes(dir.root))
  }

  @Test
  fun counts_nothing_for_preferences_alone() {
    write("shared_prefs/TaskManagerModule.xml", 300)
    write("shared_prefs/SecureStore.xml", 900)
    write("shared_prefs/${AutoBackupLedger.PREFERENCES}.xml", 700)

    assertEquals(0L, BackupPayload.bytes(dir.root))
  }

  @Test
  fun leaves_out_files_the_rules_do_not_name() {
    write("files/veloq-decisions.zip", 4_000)
    write("files/routes.db", 90_000)
    write("files/backups/veloq-old.zip", 8_000)

    assertEquals(4_000L, BackupPayload.bytes(dir.root))
  }

  @Test
  fun a_phone_with_nothing_to_back_up_counts_nothing() {
    assertEquals(0L, BackupPayload.bytes(dir.root))
  }
}
