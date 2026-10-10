package com.veloq.backupexclusion

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.app.usage.StorageStatsManager
import android.os.Process
import android.os.storage.StorageManager
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val REQUEST_AUTHORIZE_GOOGLE_DRIVE = 0x5644

/**
 * The Android side of the backup module: the backup folder's grant release, the
 * platform's storage figure for the app, what Auto Backup last did as the
 * backup agent recorded it, and Google's authorisation for Veloq's own app
 * data folder in the athlete's Drive. The device backup rules here are an
 * allowlist, so nothing is excluded.
 */
class VeloqBackupExclusionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** The sign-in waiting on the consent screen, settled when the activity returns. */
  private var pendingAuthorization: Promise? = null

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

    // An access token for the app data folder. Play services holds the grant and
    // refreshes the token, so nothing is stored here. With `interactive` false a
    // grant that needs the account picker or consent screen is refused rather
    // than shown, because a backup run has nobody watching.
    AsyncFunction("authorizeGoogleDrive") { interactive: Boolean, promise: Promise ->
      val activity = appContext.throwingActivity
      val request = AuthorizationRequest.builder()
        .setRequestedScopes(listOf(Scope(GoogleDriveAuthorization.DRIVE_APPDATA_SCOPE)))
        .build()
      Identity.getAuthorizationClient(activity).authorize(request)
        .addOnSuccessListener { result ->
          val resolution = result.pendingIntent
          if (!result.hasResolution() || resolution == null) {
            resolveToken(promise, result)
            return@addOnSuccessListener
          }
          if (!interactive) {
            promise.reject(GoogleDriveAuthorization.SIGN_IN_NEEDED, "Google needs a sign-in", null)
            return@addOnSuccessListener
          }
          if (pendingAuthorization != null) {
            promise.reject(
              GoogleDriveAuthorization.AUTHORIZATION_FAILED,
              "A Google sign-in is already showing",
              null
            )
            return@addOnSuccessListener
          }
          pendingAuthorization = promise
          try {
            activity.startIntentSenderForResult(
              resolution.intentSender,
              REQUEST_AUTHORIZE_GOOGLE_DRIVE,
              null,
              0,
              0,
              0
            )
          } catch (e: IntentSender.SendIntentException) {
            pendingAuthorization = null
            promise.reject(GoogleDriveAuthorization.AUTHORIZATION_FAILED, e.message, e)
          }
        }
        .addOnFailureListener { error -> rejectAuthorization(promise, error) }
    }

    OnActivityResult { activity, (requestCode, resultCode, data) ->
      if (requestCode != REQUEST_AUTHORIZE_GOOGLE_DRIVE) return@OnActivityResult
      val promise = pendingAuthorization ?: return@OnActivityResult
      pendingAuthorization = null
      if (resultCode != Activity.RESULT_OK) {
        promise.reject(GoogleDriveAuthorization.SIGN_IN_CANCELLED, "The Google sign-in was dismissed", null)
        return@OnActivityResult
      }
      try {
        resolveToken(promise, Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data))
      } catch (error: ApiException) {
        rejectAuthorization(promise, error)
      }
    }

    // A token Drive refused leaves Play services' cache, so the next request is
    // handed a fresh one. It blocks on Play services, so it runs off the main thread.
    AsyncFunction("clearGoogleDriveToken") { token: String ->
      GoogleAuthUtil.clearToken(context, token)
    }

    // What Auto Backup last did, as VeloqBackupAgent heard it. Each value is null
    // until the platform has called the agent for it.
    Function("getAutoBackupStatus") {
      val status = AutoBackupLedger.forContext(context).status()
      mapOf(
        "backedUpAt" to status.backedUpAt?.toDouble(),
        "backedUpBytes" to status.backedUpBytes?.toDouble(),
        "quotaExceededAt" to status.quotaExceededAt?.toDouble(),
        "quotaExceededBytes" to status.quotaExceededBytes?.toDouble(),
        "quotaBytes" to status.quotaBytes?.toDouble(),
        "restoredAt" to status.restoredAt?.toDouble()
      )
    }

    // The folder picker took a persistable grant on the tree. Giving it back
    // takes the folder off the grants the system holds for the app, which are
    // capped in number. A grant already gone has nothing to release.
    Function("releaseFolderGrant") { uri: String ->
      val resolver = context.contentResolver
      val held = resolver.persistedUriPermissions.filter {
        FolderGrant.isHeldTree(uri, it.uri.toString())
      }
      for (grant in held) {
        var flags = 0
        if (grant.isReadPermission) flags = flags or Intent.FLAG_GRANT_READ_URI_PERMISSION
        if (grant.isWritePermission) flags = flags or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        resolver.releasePersistableUriPermission(grant.uri, flags)
      }
    }
  }

  private fun resolveToken(promise: Promise, result: AuthorizationResult) {
    val token = result.accessToken
    if (token == null) {
      promise.reject(GoogleDriveAuthorization.AUTHORIZATION_FAILED, "Google returned no access token", null)
    } else {
      promise.resolve(token)
    }
  }

  private fun rejectAuthorization(promise: Promise, error: Exception) {
    val code = GoogleDriveAuthorization.refusalCode((error as? ApiException)?.statusCode)
    promise.reject(code, error.message, error)
  }
}
