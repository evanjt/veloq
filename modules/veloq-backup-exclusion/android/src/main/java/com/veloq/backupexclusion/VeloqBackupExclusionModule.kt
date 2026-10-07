package com.veloq.backupexclusion

import android.content.Context
import android.content.Intent
import android.app.usage.StorageStatsManager
import android.net.Uri
import android.os.Process
import android.os.storage.StorageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Android side of the backup module: the backup folder's grant release, and
 * the platform's storage figure for the app. The device backup rules here are
 * an allowlist, so nothing is excluded.
 */
class VeloqBackupExclusionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VeloqBackupExclusion")

    // The figure Android's app info shows: user data and cache, by allocated
    // blocks. An app asking about its own package needs no permission.
    AsyncFunction("getAppStorageStats") {
      val manager = context.getSystemService(Context.STORAGE_STATS_SERVICE) as StorageStatsManager
      val stats = manager.queryStatsForPackage(
        StorageManager.UUID_DEFAULT,
        context.packageName,
        Process.myUserHandle()
      )
      // The platform's data figure includes the cache, so the user data the app
      // info screen lists beside it is the difference.
      mapOf(
        "dataBytes" to (stats.dataBytes - stats.cacheBytes).coerceAtLeast(0L).toDouble(),
        "cacheBytes" to stats.cacheBytes.toDouble()
      )
    }

    // The folder picker took a persistable grant on the tree. Giving it back
    // takes the folder off the grants the system holds for the app, which are
    // capped in number. A grant already gone has nothing to release.
    Function("releaseFolderGrant") { uri: String ->
      val tree = Uri.parse(uri)
      val resolver = context.contentResolver
      for (grant in resolver.persistedUriPermissions.filter { it.uri == tree }) {
        var flags = 0
        if (grant.isReadPermission) flags = flags or Intent.FLAG_GRANT_READ_URI_PERMISSION
        if (grant.isWritePermission) flags = flags or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        resolver.releasePersistableUriPermission(tree, flags)
      }
    }
  }
}
