package com.veloq.backupexclusion

object FolderGrant {
  /**
   * Whether a persisted grant is the one on the held folder. The picker hands back the
   * directory with a trailing slash and the system records the grant on the tree without one,
   * so the two are compared without it.
   */
  fun isHeldTree(held: String, granted: String): Boolean =
    held.trimEnd('/') == granted.trimEnd('/')
}
