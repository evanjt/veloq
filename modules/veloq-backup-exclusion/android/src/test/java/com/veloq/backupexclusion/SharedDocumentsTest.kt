package com.veloq.backupexclusion

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the device copy of a backup goes to the shared `Documents/Veloq` through the media
 * store, which takes a relative path only from Android 10 and records it with a trailing slash.
 *
 * Expected behaviour: the folder is offered from Android 10 only, and a listing keeps the rows
 * in the folder itself, never a sibling whose name starts the same or a folder beneath it.
 */
class SharedDocumentsTest {
  @Test
  fun the_folder_is_offered_from_android_10() {
    assertTrue(SharedDocuments.isSupported(29))
    assertTrue(SharedDocuments.isSupported(36))
  }

  @Test
  fun the_folder_is_not_offered_below_android_10() {
    assertFalse(SharedDocuments.isSupported(28))
    assertFalse(SharedDocuments.isSupported(24))
  }

  @Test
  fun a_row_in_the_folder_is_kept_with_or_without_the_trailing_slash() {
    assertTrue(SharedDocuments.isInFolder("Documents/Veloq/"))
    assertTrue(SharedDocuments.isInFolder("Documents/Veloq"))
  }

  @Test
  fun a_sibling_or_a_folder_beneath_is_left_out() {
    assertFalse(SharedDocuments.isInFolder("Documents/VeloqOld/"))
    assertFalse(SharedDocuments.isInFolder("Documents/Veloq/old/"))
    assertFalse(SharedDocuments.isInFolder(null))
  }
}
