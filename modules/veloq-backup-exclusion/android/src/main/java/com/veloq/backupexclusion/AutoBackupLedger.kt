package com.veloq.backupexclusion

import android.content.Context
import java.io.File

/**
 * What Android's Auto Backup last did with the app, as its backup agent heard it: the last
 * backup and its size, the last payload over the quota with both numbers, and the last restore.
 * Android tells the app nothing else, and drops an over-quota payload whole.
 *
 * Every run calls the agent's `onFullBackup` once to measure the payload and again to send it
 * only when it fits; a payload over the quota gets `onQuotaExceeded` after the first call
 * instead. So a backup is recorded on each call, the one it replaced is kept beside it, and an
 * overrun puts that one back.
 */
class AutoBackupLedger(private val store: Store) {
  /** Where the record is kept. A null value removes the key; one `write` is one commit. */
  interface Store {
    fun read(key: String): Long?

    fun write(changes: Map<String, Long?>)
  }

  data class Status(
    val backedUpAt: Long?,
    val backedUpBytes: Long?,
    val quotaExceededAt: Long?,
    val quotaExceededBytes: Long?,
    val quotaBytes: Long?,
    val restoredAt: Long?
  )

  fun recordBackup(at: Long, bytes: Long) {
    store.write(
      mapOf(
        PRIOR_AT to store.read(BACKED_UP_AT),
        PRIOR_BYTES to store.read(BACKED_UP_BYTES),
        BACKED_UP_AT to at,
        BACKED_UP_BYTES to bytes
      )
    )
  }

  fun recordQuotaExceeded(at: Long, dataBytes: Long, quotaBytes: Long) {
    store.write(
      mapOf(
        BACKED_UP_AT to store.read(PRIOR_AT),
        BACKED_UP_BYTES to store.read(PRIOR_BYTES),
        QUOTA_EXCEEDED_AT to at,
        QUOTA_EXCEEDED_BYTES to dataBytes,
        QUOTA_BYTES to quotaBytes
      )
    )
  }

  fun recordRestore(at: Long) {
    store.write(mapOf(RESTORED_AT to at))
  }

  fun status() = Status(
    backedUpAt = store.read(BACKED_UP_AT),
    backedUpBytes = store.read(BACKED_UP_BYTES),
    quotaExceededAt = store.read(QUOTA_EXCEEDED_AT),
    quotaExceededBytes = store.read(QUOTA_EXCEEDED_BYTES),
    quotaBytes = store.read(QUOTA_BYTES),
    restoredAt = store.read(RESTORED_AT)
  )

  companion object {
    /**
     * The preferences file the record is kept in. The backup rules carry no preferences, so a
     * restore does not bring another phone's record.
     */
    const val PREFERENCES = "veloq_auto_backup"

    private const val BACKED_UP_AT = "backedUpAt"
    private const val BACKED_UP_BYTES = "backedUpBytes"
    private const val PRIOR_AT = "priorBackedUpAt"
    private const val PRIOR_BYTES = "priorBackedUpBytes"
    private const val QUOTA_EXCEEDED_AT = "quotaExceededAt"
    private const val QUOTA_EXCEEDED_BYTES = "quotaExceededBytes"
    private const val QUOTA_BYTES = "quotaBytes"
    private const val RESTORED_AT = "restoredAt"

    fun forContext(context: Context): AutoBackupLedger {
      val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      return AutoBackupLedger(
        object : Store {
          override fun read(key: String): Long? =
            if (preferences.contains(key)) preferences.getLong(key, 0L) else null

          // Committed rather than applied: the platform may end the process as soon as the
          // agent returns.
          override fun write(changes: Map<String, Long?>) {
            val editor = preferences.edit()
            for ((key, value) in changes) {
              if (value == null) editor.remove(key) else editor.putLong(key, value)
            }
            editor.commit()
          }
        }
      )
    }
  }
}

/**
 * The size of what the backup rules carry, which the platform does not hand the agent: the latest
 * record zip alone, the one path the rules files written by `with-android-backup.js` name. No
 * preferences file is carried, so none is counted.
 */
object BackupPayload {
  const val RECORD_ZIP = "veloq-decisions.zip"

  /** Bytes of the record zip under the app's data directory, the parent of `files`. */
  fun bytes(dataDir: File): Long {
    val zip = File(File(dataDir, "files"), RECORD_ZIP)
    return if (zip.isFile) zip.length() else 0L
  }
}
