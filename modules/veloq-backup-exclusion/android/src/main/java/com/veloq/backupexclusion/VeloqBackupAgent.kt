package com.veloq.backupexclusion

import android.app.backup.BackupAgent
import android.app.backup.BackupDataInput
import android.app.backup.BackupDataOutput
import android.app.backup.FullBackupDataOutput
import android.os.Build
import android.os.ParcelFileDescriptor

/**
 * The app's backup agent, which leaves Auto Backup doing what it did and records what it did.
 * The manifest names it with `android:fullBackupOnly`, so the platform makes a full backup
 * governed by the rules files and never calls the key-value methods; the default
 * `onFullBackup` is what reads those rules.
 */
class VeloqBackupAgent : BackupAgent() {
  private val ledger by lazy { AutoBackupLedger.forContext(this) }

  override fun onFullBackup(data: FullBackupDataOutput) {
    super.onFullBackup(data)
    // A transfer to a new phone is not a backup Android keeps. Before Android 9 the platform
    // does not say which it is.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      data.transportFlags and FLAG_DEVICE_TO_DEVICE_TRANSFER != 0
    ) return
    ledger.recordBackup(System.currentTimeMillis(), BackupPayload.bytes(dataDir))
  }

  override fun onQuotaExceeded(backupDataBytes: Long, quotaBytes: Long) {
    ledger.recordQuotaExceeded(System.currentTimeMillis(), backupDataBytes, quotaBytes)
  }

  override fun onRestoreFinished() {
    ledger.recordRestore(System.currentTimeMillis())
  }

  override fun onBackup(
    oldState: ParcelFileDescriptor?,
    data: BackupDataOutput?,
    newState: ParcelFileDescriptor?
  ) = Unit

  override fun onRestore(data: BackupDataInput?, appVersionCode: Int, newState: ParcelFileDescriptor?) =
    Unit
}
