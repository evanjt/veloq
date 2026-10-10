package com.veloq.backupexclusion

/**
 * What the Google Drive authorisation asks for, and the codes the bridge reads off a refusal.
 * The status values are Play services' `CommonStatusCodes`, held here as numbers so the mapping
 * is a plain function.
 */
object GoogleDriveAuthorization {
  /** Veloq's own hidden app data folder, and nothing else in the athlete's Drive. */
  const val DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata"

  /** A silent request found no grant: the athlete has to sign in again. */
  const val SIGN_IN_NEEDED = "ERR_GOOGLE_SIGN_IN_NEEDED"

  /** The athlete dismissed the account picker or the consent screen. */
  const val SIGN_IN_CANCELLED = "ERR_GOOGLE_SIGN_IN_CANCELLED"

  /** Anything else: no network, Play services out of date, or a build Google does not know. */
  const val AUTHORIZATION_FAILED = "ERR_GOOGLE_AUTHORIZATION_FAILED"

  private const val STATUS_SIGN_IN_REQUIRED = 4
  private const val STATUS_CANCELED = 16

  fun refusalCode(statusCode: Int?): String = when (statusCode) {
    STATUS_SIGN_IN_REQUIRED -> SIGN_IN_NEEDED
    STATUS_CANCELED -> SIGN_IN_CANCELLED
    else -> AUTHORIZATION_FAILED
  }
}
