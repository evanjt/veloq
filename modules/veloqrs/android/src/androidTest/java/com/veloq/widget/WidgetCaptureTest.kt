package com.veloq.widget

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Xml
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.veloq.test.R
import com.veloq.test.widget.InsightsWidgetRenderer
import com.veloq.test.widget.StrengthWidget
import com.veloq.test.widget.StrengthWidgetRenderer
import com.veloq.test.widget.VeloqRecordWidgetProvider
import com.veloq.test.widget.WidgetRenderer
import com.veloq.test.widget.WidgetSnapshot
import java.io.File
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.xmlpull.v1.XmlPullParser

/**
 * Scenario: every widget is placed at the smallest, the target and the largest size its provider
 * info allows, in light and dark, with the sample library, with the longest words the locales
 * have, with an empty library and with rides and no wellness reading.
 *
 * Expected behaviour: no line of text is ellipsised, clipped or pushed out of its parent. An empty
 * library draws the open-the-app prompt, and a missing wellness reading draws a dash. Every
 * placement is saved as a PNG under the test package's external files, `widget-captures/`, so a
 * failure can be looked at rather than only read.
 *
 * Runs on a device: RemoteViews inflate and lay out only against the platform's own views.
 */
@RunWith(AndroidJUnit4::class)
class WidgetCaptureTest {
  private val context: Context
    get() = InstrumentationRegistry.getInstrumentation().targetContext

  private class Widget(
    val name: String,
    val info: Int,
    val render: (Context, WidgetSnapshot, Int, Int) -> RemoteViews,
  )

  private val widgets =
    listOf(
      Widget("summary", R.xml.veloq_widget_info) { c, s, w, h ->
        WidgetRenderer.render(c, s, w, h, null, 1)
      },
      Widget("activity", R.xml.widget_activity_info) { c, s, w, h ->
        WidgetRenderer.renderActivity(c, s, w, h)
      },
      Widget("insights", R.xml.widget_insights_info) { c, s, w, h ->
        InsightsWidgetRenderer.render(c, s, w, h, null, 1)
      },
      Widget("strength", R.xml.widget_strength_info) { c, s, w, h ->
        StrengthWidgetRenderer.render(c, s, w, h, StrengthWidget.LAST30)
      },
      Widget("record", R.xml.widget_record_info) { c, s, _, _ ->
        VeloqRecordWidgetProvider.render(c, s, null, 1)
      },
    )

  @Test
  fun everyWidgetDrawsEveryLineWholeAtEverySize() {
    val out = File(context.getExternalFilesDir(null), "widget-captures")
    out.deleteRecursively()
    out.mkdirs()
    val failures = mutableListOf<String>()
    val prompt = context.getString(R.string.widget_open_app)
    for (fixture in listOf("demo", "long-text", "empty", "no-wellness")) {
      val snap = snapshot(fixture)
      for (widget in widgets) {
        val expected =
          when {
            widget.name == "record" -> null
            fixture == "empty" -> prompt
            fixture == "no-wellness" && widget.name == "summary" -> "-"
            else -> null
          }
        for (cells in placements(widget.info)) {
          for (dark in listOf(false, true)) {
            val name = "${widget.name}-${cells.cols}x${cells.rows}-$fixture-${if (dark) "dark" else "light"}"
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
              failures += capture(name, widget, snap, cells, themed(dark), out, expected)
            }
          }
        }
      }
    }
    assertTrue(
      "Cut-off or missing text in ${failures.size} places, captures in $out:\n" + failures.joinToString("\n"),
      failures.isEmpty())
  }

  private fun snapshot(fixture: String): WidgetSnapshot {
    val text =
      InstrumentationRegistry.getInstrumentation().context.assets.open("$fixture.json").use {
        it.readBytes().toString(Charsets.UTF_8)
      }
    return WidgetSnapshot.parse(JSONObject(text))
  }

  private fun themed(dark: Boolean): Context {
    val config = Configuration(context.resources.configuration)
    val night = if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
    config.uiMode = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or night
    return context.createConfigurationContext(config)
  }

  private data class Cells(val cols: Int, val rows: Int)

  /**
   * The smallest, target and largest placements the provider info allows, in cells, on a grid of
   * at most four by four. A size given in dp becomes cells by the platform's rule that n cells
   * need 70n - 30 dp.
   */
  private fun placements(info: Int): List<Cells> {
    val parser = context.resources.getXml(info)
    while (parser.next() != XmlPullParser.START_TAG) continue
    val attrs = Xml.asAttributeSet(parser)
    val ids =
      intArrayOf(
          android.R.attr.minWidth,
          android.R.attr.minHeight,
          android.R.attr.minResizeWidth,
          android.R.attr.minResizeHeight,
          android.R.attr.maxResizeWidth,
          android.R.attr.maxResizeHeight,
          android.R.attr.resizeMode,
          android.R.attr.targetCellWidth,
          android.R.attr.targetCellHeight,
        )
        .sorted()
        .toIntArray()
    val a = context.obtainStyledAttributes(attrs, ids)
    val dm = context.resources.displayMetrics
    fun dp(attr: Int): Float? {
      val i = ids.indexOf(attr)
      return if (a.hasValue(i)) a.getDimension(i, 0f) / dm.density else null
    }
    fun int(attr: Int): Int? {
      val i = ids.indexOf(attr)
      return if (a.hasValue(i)) a.getInt(i, 0) else null
    }
    val minW = dp(android.R.attr.minWidth) ?: 0f
    val minH = dp(android.R.attr.minHeight) ?: 0f
    val resize = int(android.R.attr.resizeMode) ?: 0
    val target =
      Cells(
        int(android.R.attr.targetCellWidth) ?: cellsAtLeast(minW),
        int(android.R.attr.targetCellHeight) ?: cellsAtLeast(minH))
    val horizontal = resize and 1 != 0
    val vertical = resize and 2 != 0
    val smallest =
      Cells(
        if (horizontal) cellsAtLeast(dp(android.R.attr.minResizeWidth) ?: minW) else target.cols,
        if (vertical) cellsAtLeast(dp(android.R.attr.minResizeHeight) ?: minH) else target.rows)
    val largest =
      Cells(
        if (horizontal) cellsAtMost(dp(android.R.attr.maxResizeWidth)) else target.cols,
        if (vertical) cellsAtMost(dp(android.R.attr.maxResizeHeight)) else target.rows)
    a.recycle()
    parser.close()
    return listOf(smallest, target, largest).distinct()
  }

  private fun cellsAtLeast(dp: Float): Int = ceil((dp + 30f) / 70f).toInt().coerceIn(1, GRID)

  private fun cellsAtMost(dp: Float?): Int =
    if (dp == null) GRID else floor((dp + 30f) / 70f).toInt().coerceIn(1, GRID)

  /**
   * Draws one placement and lists what it cuts off. The box is a portrait phone's, from the
   * platform's table of the smallest size a placement gets, and the renderer is told the sizes a
   * launcher reports: the portrait width and the landscape height.
   */
  private fun capture(
    name: String,
    widget: Widget,
    snap: WidgetSnapshot,
    cells: Cells,
    themed: Context,
    out: File,
    expected: String?,
  ): List<String> {
    val widthDp = 73 * cells.cols - 16
    val heightDp = 118 * cells.rows - 16
    val reportedHeightDp = 66 * cells.rows - 15
    val views = widget.render(themed, snap, widthDp, reportedHeightDp)
    val density = themed.resources.displayMetrics.density
    val w = (widthDp * density).roundToInt()
    val h = (heightDp * density).roundToInt()
    val host = FrameLayout(themed)
    host.addView(views.apply(themed, host), FrameLayout.LayoutParams(w, h))
    host.measure(
      View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
    host.layout(0, 0, w, h)
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    host.draw(Canvas(bitmap))
    File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    val found = mutableListOf<String>()
    inspect(host, name, found)
    if (expected != null && expected !in shownTexts(host)) found += "$name: draws no \"$expected\""
    return found
  }

  private fun shownTexts(view: View): List<String> =
    when {
      view.visibility != View.VISIBLE -> emptyList()
      view is TextView -> listOf(view.text.toString())
      view is ViewGroup -> (0 until view.childCount).flatMap { shownTexts(view.getChildAt(it)) }
      else -> emptyList()
    }

  private fun inspect(view: View, name: String, found: MutableList<String>) {
    if (view.visibility != View.VISIBLE) return
    val parent = view.parent as? View
    if (parent != null && view !== parent) {
      val slack = 1
      if (view.left < -slack || view.top < -slack ||
        view.right > parent.width + slack || view.bottom > parent.height + slack) {
        found += "$name: ${label(view)} leaves its parent"
      }
    }
    if (view is TextView) cutOff(view)?.let { found += "$name: ${label(view)} $it" }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) inspect(view.getChildAt(i), name, found)
    }
  }

  /** Why a line of [view] is not shown whole, or null when every line is. */
  private fun cutOff(view: TextView): String? {
    if (view.text.isNullOrEmpty()) return null
    val layout = view.layout ?: return "has no room to lay out \"${view.text}\""
    val shown = min(layout.lineCount, view.maxLines)
    for (line in 0 until shown) {
      if (layout.getEllipsisCount(line) > 0) return "is ellipsised: \"${view.text}\""
    }
    if (layout.lineCount > view.maxLines) return "needs more lines than it shows: \"${view.text}\""
    val room = view.height - view.compoundPaddingTop - view.compoundPaddingBottom
    if (layout.getLineBottom(shown - 1) > room + 1) return "is taller than its box: \"${view.text}\""
    val across = view.width - view.compoundPaddingLeft - view.compoundPaddingRight
    for (line in 0 until shown) {
      if (layout.getLineWidth(line) > max(across, 0) + 1) {
        return "is wider than its box: \"${view.text}\""
      }
    }
    return null
  }

  private fun label(view: View): String =
    if (view.id == View.NO_ID) view.javaClass.simpleName
    else runCatching { view.resources.getResourceEntryName(view.id) }.getOrDefault("#${view.id}")

  private companion object {
    const val GRID = 4
  }
}
