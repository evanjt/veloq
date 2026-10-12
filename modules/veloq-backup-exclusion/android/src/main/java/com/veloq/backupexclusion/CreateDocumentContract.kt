package com.veloq.backupexclusion

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

internal data class CreateDocumentInput(
  val name: String,
  val mimeType: String,
  val initialTree: String?
) : Serializable

/**
 * The system's create-document screen: the athlete picks where a file goes and
 * may rename it, and the app is handed a document to write into, or null when
 * the screen was backed out of.
 */
internal class CreateDocumentContract : AppContextActivityResultContract<CreateDocumentInput, Uri?> {
  override fun createIntent(context: Context, input: CreateDocumentInput): Intent =
    Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = input.mimeType
      putExtra(Intent.EXTRA_TITLE, input.name)
      initialDocument(input.initialTree)?.let { putExtra(DocumentsContract.EXTRA_INITIAL_URI, it) }
    }

  override fun parseResult(input: CreateDocumentInput, resultCode: Int, intent: Intent?): Uri? =
    if (resultCode == Activity.RESULT_OK) intent?.data else null

  /**
   * The screen opens on a document, not a tree, so a held folder is named by its
   * own document. A folder whose grant has gone is no starting place, and the
   * screen opens where it last was instead.
   */
  private fun initialDocument(tree: String?): Uri? {
    if (tree.isNullOrEmpty()) return null
    return try {
      val treeUri = Uri.parse(tree)
      DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri))
    } catch (e: IllegalArgumentException) {
      null
    }
  }
}
