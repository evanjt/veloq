package com.veloq.backupexclusion

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the picker hands the app a directory URI with a trailing slash, while the system
 * records the persisted grant on the tree URI without one.
 *
 * Expected behaviour: removing the folder finds its grant whichever form was held, and never
 * a grant on another folder, a parent or a child.
 */
class FolderGrantTest {
  private val tree = "content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FRides"

  @Test
  fun a_held_folder_with_the_pickers_trailing_slash_finds_its_grant() {
    assertTrue(FolderGrant.isHeldTree("$tree/", tree))
  }

  @Test
  fun a_held_folder_in_the_grants_own_form_finds_it() {
    assertTrue(FolderGrant.isHeldTree(tree, tree))
  }

  @Test
  fun a_grant_with_a_trailing_slash_is_found_too() {
    assertTrue(FolderGrant.isHeldTree(tree, "$tree/"))
  }

  @Test
  fun a_grant_on_another_folder_is_left_alone() {
    assertFalse(FolderGrant.isHeldTree("$tree/", "${tree}2"))
  }

  @Test
  fun a_grant_on_the_parent_is_left_alone() {
    val parent = "content://com.android.externalstorage.documents/tree/primary%3ADocuments"
    assertFalse(FolderGrant.isHeldTree("$tree/", parent))
  }

  @Test
  fun a_grant_on_a_child_is_left_alone() {
    assertFalse(FolderGrant.isHeldTree("$tree/", "$tree%2FOld"))
  }
}
