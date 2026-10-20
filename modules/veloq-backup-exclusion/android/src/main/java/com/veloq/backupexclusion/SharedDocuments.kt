package com.veloq.backupexclusion

import android.content.ContentResolver
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.annotation.TargetApi
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException

/**
 * The shared `Documents/Veloq` folder, reached through the media store. From Android 10 an app
 * adds files there with no storage permission, they show in the Files app, and they stay after
 * the app is uninstalled. The media store lists only the files this install wrote, so a zip an
 * earlier install left is reached through the system's file picker instead.
 */
object SharedDocuments {
  /** The folder under shared storage, as the media store records it, with its trailing slash. */
  const val RELATIVE_PATH = "Documents/Veloq/"

  /** Whether the media store takes a relative path, which it does from Android 10. */
  fun isSupported(sdk: Int = Build.VERSION.SDK_INT): Boolean = sdk >= Build.VERSION_CODES.Q

  /** Whether a row the media store lists sits in the folder, whichever form of the path it holds. */
  fun isInFolder(relativePath: String?): Boolean =
    relativePath != null && relativePath.trimEnd('/') == RELATIVE_PATH.trimEnd('/')

  @TargetApi(Build.VERSION_CODES.Q)
  private fun collection(): Uri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)

  /**
   * Copy `from` into the folder as `name`, answering the name the media store gave it, which
   * carries a suffix when the name was taken. The row is pending until the copy has finished,
   * so nothing reads a partial zip, and a copy that fails takes its row with it.
   */
  @TargetApi(Build.VERSION_CODES.Q)
  fun write(resolver: ContentResolver, from: String, name: String, mimeType: String): String {
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, name)
      put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, RELATIVE_PATH)
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val target = resolver.insert(collection(), values)
      ?: throw IOException("The media store refused a file in $RELATIVE_PATH")
    try {
      val out = resolver.openOutputStream(target, "wt")
        ?: throw IOException("The media store gave no stream for $name")
      out.use { sink -> File(from).inputStream().use { it.copyTo(sink) } }
      resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      try {
        resolver.delete(target, null, null)
      } catch (ignored: Exception) {
        // A store that refused the write may refuse the delete as well.
      }
      throw e
    }
    return displayName(resolver, target) ?: name
  }

  /** The files this install wrote to the folder, by name and size. */
  @TargetApi(Build.VERSION_CODES.Q)
  fun list(resolver: ContentResolver): List<Pair<String, Long>> {
    val files = mutableListOf<Pair<String, Long>>()
    resolver.query(
      collection(),
      arrayOf(
        MediaStore.MediaColumns.DISPLAY_NAME,
        MediaStore.MediaColumns.SIZE,
        MediaStore.MediaColumns.RELATIVE_PATH
      ),
      "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ? AND ${MediaStore.MediaColumns.IS_PENDING} = 0",
      arrayOf("${RELATIVE_PATH.trimEnd('/')}%"),
      null
    )?.use { cursor ->
      while (cursor.moveToNext()) {
        if (!isInFolder(cursor.getString(2))) continue
        val name = cursor.getString(0) ?: continue
        files.add(name to cursor.getLong(1))
      }
    }
    return files
  }

  /** Copy the file `name` out of the folder to the path `to`. */
  @TargetApi(Build.VERSION_CODES.Q)
  fun read(resolver: ContentResolver, name: String, to: String) {
    val source = find(resolver, name) ?: throw FileNotFoundException("No $name in $RELATIVE_PATH")
    val input = resolver.openInputStream(source)
      ?: throw IOException("The media store gave no stream for $name")
    input.use { from -> File(to).outputStream().use { from.copyTo(it) } }
  }

  @TargetApi(Build.VERSION_CODES.Q)
  private fun find(resolver: ContentResolver, name: String): Uri? {
    resolver.query(
      collection(),
      arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.RELATIVE_PATH),
      "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.IS_PENDING} = 0",
      arrayOf(name),
      null
    )?.use { cursor ->
      while (cursor.moveToNext()) {
        if (isInFolder(cursor.getString(1))) {
          return Uri.withAppendedPath(collection(), cursor.getLong(0).toString())
        }
      }
    }
    return null
  }

  private fun displayName(resolver: ContentResolver, uri: Uri): String? =
    resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use {
      if (it.moveToFirst()) it.getString(0) else null
    }
}
