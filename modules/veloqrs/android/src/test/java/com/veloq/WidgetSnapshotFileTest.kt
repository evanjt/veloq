package com.veloq

import java.io.File
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scenario: the app's JavaScript and a background worker in the same process
 * write the widget snapshot at the same moment, while a provider redraws and
 * reads it.
 *
 * Expected behaviour: every read sees one writer's whole snapshot, never a
 * truncated or interleaved file, and no temporary file is left behind.
 */
class WidgetSnapshotFileTest {
  private val dir: File = Files.createTempDirectory("snapshot-dir").toFile()

  @After
  fun removeDir() {
    dir.deleteRecursively()
  }

  /** A complete snapshot large enough that a write takes more than one system call. */
  private fun payload(tag: String): String =
    """{"tag":"$tag","rows":"${tag.repeat(256 * 1024)}"}"""

  @Test
  fun overlapping_writers_never_leave_a_partial_snapshot_or_a_temp_file() {
    val first = payload("a")
    val second = payload("b")
    val stop = AtomicBoolean(false)
    val torn = AtomicReference<String?>(null)
    val reader = Thread {
      val dest = File(dir, WidgetSnapshotFile.NAME)
      while (!stop.get()) {
        val text = try {
          dest.readText()
        } catch (_: java.io.IOException) {
          continue
        }
        if (text != first && text != second) {
          torn.compareAndSet(null, "read ${text.length} characters, neither whole snapshot")
        }
      }
    }
    val writers = listOf(first, second).map { json ->
      Thread { repeat(200) { WidgetSnapshotFile.write(dir, json) } }
    }
    reader.start()
    writers.forEach { it.start() }
    writers.forEach { it.join() }
    stop.set(true)
    reader.join()

    assertNull(torn.get())
    val last = File(dir, WidgetSnapshotFile.NAME).readText()
    assertTrue(last == first || last == second)
    assertEquals(listOf(WidgetSnapshotFile.NAME), dir.list()!!.toList())
  }

  @Test
  fun a_second_write_replaces_the_first_whole() {
    WidgetSnapshotFile.write(dir, payload("a"))
    WidgetSnapshotFile.write(dir, """{"tag":"b"}""")

    assertEquals("""{"tag":"b"}""", File(dir, WidgetSnapshotFile.NAME).readText())
    assertEquals(listOf(WidgetSnapshotFile.NAME), dir.list()!!.toList())
  }

  @Test
  fun clearing_removes_the_snapshot_and_what_a_killed_write_left() {
    WidgetSnapshotFile.write(dir, """{"tag":"a"}""")
    File(dir, "${WidgetSnapshotFile.NAME}.tmp").writeText("""{"ta""")
    File.createTempFile("widget-snapshot", ".tmp", dir).writeText("""{"t""")
    File(dir, "routes.db").writeText("library")

    WidgetSnapshotFile.clear(dir)

    assertEquals(listOf("routes.db"), dir.list()!!.toList())
  }

  @Test
  fun clearing_with_nothing_written_is_harmless() {
    WidgetSnapshotFile.clear(dir)

    assertEquals(emptyList<String>(), dir.list()!!.toList())
  }
}
