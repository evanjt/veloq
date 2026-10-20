package com.veloq.widget

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.graphics.drawable.BitmapDrawable
import android.os.SystemClock
import android.util.Xml
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.RemoteViews
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.veloq.test.R
import com.veloq.test.widget.InsightsWidgetRenderer
import com.veloq.test.widget.StrengthWidget
import com.veloq.test.widget.StrengthWidgetRenderer
import com.veloq.test.widget.SummaryPlacement
import com.veloq.test.widget.SummarySize
import com.veloq.test.widget.SummaryWidget
import com.veloq.test.widget.WidgetRenderer
import com.veloq.test.widget.WidgetSnapshot
import java.io.File
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
 * library draws the open-the-app prompt, a missing wellness reading draws a dash, the Summary
 * hero's line names the rest of training load from Medium up and its chart its series and span,
 * and the large form chart its zone and span. Every
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
        WidgetRenderer.render(c, s, w, h, SummaryPlacement(), 1)
      },
      Widget("activity", R.xml.widget_activity_info) { c, s, w, h ->
        WidgetRenderer.renderActivity(c, s, w, h)
      },
      Widget("insights", R.xml.widget_insights_info) { c, s, w, h ->
        InsightsWidgetRenderer.render(c, s, w, h, null, 1)
      },
      Widget("strength", R.xml.widget_strength_info) { c, s, w, h ->
        StrengthWidgetRenderer.render(c, s, w, h)
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
            fixture == "empty" -> prompt
            fixture == "no-wellness" && widget.name == "summary" -> "-"
            else -> null
          }
        for (cells in placements(widget.info)) {
          val texts = listOfNotNull(expected) + chartWords(widget.name, fixture, snap, cells)
          for (dark in listOf(false, true)) {
            val name = "${widget.name}-${cells.cols}x${cells.rows}-$fixture-${if (dark) "dark" else "light"}"
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
              failures += capture(name, widget, snap, cells, themed(dark), out, texts)
            }
          }
        }
      }
    }
    assertTrue(
      "Cut-off or missing text in ${failures.size} places, captures in $out:\n" + failures.joinToString("\n"),
      failures.isEmpty())
  }

  /**
   * The words a Summary placement draws with its charts from the sample library: from Medium up
   * the training load on the hero's line, each reading's name and value, and the chart's two
   * series and their span where [SummaryWidget.captionsChart] gives it a legend; on Large the
   * form chart's zone and span.
   */
  private fun chartWords(
    widget: String,
    fixture: String,
    snap: WidgetSnapshot,
    cells: Cells,
  ): List<String> {
    if (widget != "summary" || fixture != "demo") return emptyList()
    val (w, h) = widthAndReportedHeight(cells)
    val size = SummaryWidget.sizeFor(w, h)
    if (size != SummarySize.MEDIUM && size != SummarySize.LARGE) return emptyList()
    // The sample's hero is form, so its line carries all three readings of training load.
    val load =
      listOf("fitness", "fatigue", "form").mapNotNull { snap.metricLabels[it] } +
        listOf(snap.fitness, snap.fatigue, snap.form).map { it.display() }
    val legend =
      if (SummaryWidget.captionsChart(size, h)) {
        listOfNotNull(
          snap.metricLabels["fitness"], snap.metricLabels["fatigue"], snap.chartSpans.fitness)
      } else {
        emptyList()
      }
    val words = load + legend
    if (size == SummarySize.MEDIUM) return words
    return words + listOfNotNull(snap.formZoneLabel, snap.chartSpans.form)
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
    expected: List<String>,
  ): List<String> {
    val (widthDp, reportedHeightDp) = widthAndReportedHeight(cells)
    val views = widget.render(themed, snap, widthDp, reportedHeightDp)
    val host = place(views, themed, cells)
    val w = host.width
    val h = host.height
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    host.draw(Canvas(bitmap))
    File(out, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    val found = mutableListOf<String>()
    inspect(host, name, found)
    val shown = shownTexts(host)
    for (text in expected) if (text !in shown) found += "$name: draws no \"$text\""
    return found
  }

  /** Applies [views] the way a host does, in a portrait phone's box for [cells], laid out. */
  private fun place(views: RemoteViews, themed: Context, cells: Cells): FrameLayout {
    val density = themed.resources.displayMetrics.density
    val w = ((73 * cells.cols - 16) * density).roundToInt()
    val h = ((118 * cells.rows - 16) * density).roundToInt()
    val host = FrameLayout(themed)
    host.addView(views.apply(themed, host), FrameLayout.LayoutParams(w, h))
    host.measure(
      View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
    host.layout(0, 0, w, h)
    return host
  }

  /**
   * Scenario: a launcher keeps the views a widget was rendered with and applies them again when
   * the system switches between light and dark, with no redraw from the app.
   *
   * Expected behaviour: views rendered in one theme and applied in the other give every line of
   * text, every tint and every image the colours of views rendered in the theme they are applied
   * in.
   */
  @Test
  fun everyWidgetTakesTheNewThemeWhenTheHostReappliesIt() {
    val failures = mutableListOf<String>()
    for (fixture in listOf("demo", "long-text", "empty", "no-wellness")) {
      val snap = snapshot(fixture)
      for (widget in widgets) {
        for (cells in placements(widget.info)) {
          for (renderedDark in listOf(false, true)) {
            val shown = if (renderedDark) "light" else "dark"
            val name = "${widget.name}-${cells.cols}x${cells.rows}-$fixture-shown-$shown"
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
              val (w, h) = widthAndReportedHeight(cells)
              val applied = themed(!renderedDark)
              val kept = place(widget.render(themed(renderedDark), snap, w, h), applied, cells)
              val fresh = place(widget.render(applied, snap, w, h), applied, cells)
              compareColours(kept, fresh, name, failures)
            }
          }
        }
      }
    }
    assertTrue(
      "Kept the theme it was rendered in at ${failures.size} places:\n" +
        failures.joinToString("\n"),
      failures.isEmpty())
  }

  /**
   * Scenario: every widget at its largest placement carries its images for both themes in one
   * update.
   *
   * Expected behaviour: the images both themes show together stay inside the bitmap memory a
   * host accepts for one widget update, the memory needed to fill the screen 1.5 times.
   */
  @Test
  fun everyWidgetsImagesForBothThemesFitOneUpdate() {
    val metrics = context.resources.displayMetrics
    val limit = metrics.widthPixels.toLong() * metrics.heightPixels * 4 * 3 / 2
    val failures = mutableListOf<String>()
    for (fixture in listOf("demo", "long-text")) {
      val snap = snapshot(fixture)
      for (widget in widgets) {
        val cells = placements(widget.info).maxByOrNull { it.cols * it.rows } ?: continue
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
          val (w, h) = widthAndReportedHeight(cells)
          val views = widget.render(themed(false), snap, w, h)
          val bytes = imageBytes(place(views, themed(false), cells)) +
            imageBytes(place(views, themed(true), cells))
          if (bytes > limit) failures += "${widget.name}-$fixture: $bytes bytes against $limit"
        }
      }
    }
    assertTrue("Over the host's bitmap limit:\n" + failures.joinToString("\n"), failures.isEmpty())
  }

  /**
   * Scenario: the Summary widget is placed on a phone with the largest font scale, idle and while
   * a refresh runs, at each placement wide enough to carry the refresh control.
   *
   * Expected behaviour: the refresh control keeps its 48dp square target and draws nothing outside
   * it at any font scale, and a running refresh shows a progress indicator in place of the symbol.
   */
  @Test
  fun refreshControlKeepsItsTargetAtLargeFontScaleAndShowsProgressWhileBusy() {
    val snap = snapshot("long-text")
    val widget = widgets.first { it.name == "summary" }
    val failures = mutableListOf<String>()
    try {
      for (busy in listOf(false, true)) {
        setBusy(busy)
        val withControl =
          placements(widget.info).filter { SummaryWidget.showsRefresh(widthAndReportedHeight(it).first) }
        for (cells in withControl) {
          val name = "summary-${cells.cols}x${cells.rows}-${if (busy) "busy" else "idle"}"
          InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val themed = fontScaled(themed(false), 2f)
            val (w, h) = widthAndReportedHeight(cells)
            val host = place(widget.render(themed, snap, w, h), themed, cells)
            val control = host.findViewById<View>(R.id.widget_refresh)
            if (control == null || control.visibility != View.VISIBLE) {
              failures += "$name: shows no refresh control"
              return@runOnMainSync
            }
            val target = (48 * themed.resources.displayMetrics.density).roundToInt()
            if (control.width != target || control.height != target) {
              failures += "$name: refresh control is ${control.width}x${control.height}px, " +
                "not ${target}px square"
            }
            inspect(control, name, failures)
            val progress = shown(control).filterIsInstance<ProgressBar>()
            if (busy && progress.isEmpty()) failures += "$name: busy draws no progress indicator"
            if (!busy && progress.isNotEmpty()) failures += "$name: idle draws a progress indicator"
            if (shown(control).any { it is TextView && !it.text.isNullOrEmpty() }) {
              failures += "$name: refresh control draws text"
            }
          }
        }
      }
    } finally {
      setBusy(false)
    }
    assertEquals(
      "Refresh control faults:\n" + failures.joinToString("\n"), emptyList<String>(), failures)
  }

  /**
   * Scenario: the Summary widget is placed at every size its provider info allows, with the
   * sample library and at the largest font scale.
   *
   * Expected behaviour: from Medium up it shows the record button, a 48dp square target that
   * says what it does and opens recording; Small and Short show none.
   */
  @Test
  fun summaryCarriesTheRecordButtonFromMediumUp() {
    val widget = widgets.first { it.name == "summary" }
    val failures = mutableListOf<String>()
    for (fixture in listOf("demo", "long-text")) {
      val snap = snapshot(fixture)
      for (cells in placements(widget.info)) {
        val name = "summary-${cells.cols}x${cells.rows}-$fixture"
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
          val themed = fontScaled(themed(false), 2f)
          val (w, h) = widthAndReportedHeight(cells)
          val host = place(widget.render(themed, snap, w, h), themed, cells)
          val button = host.findViewById<View>(R.id.sum_record)
          val shown = button != null && shown(host).contains(button)
          val size = SummaryWidget.sizeFor(w, h)
          val wanted = size == SummarySize.MEDIUM || size == SummarySize.LARGE
          if (shown != wanted) {
            failures += "$name: $size ${if (wanted) "shows no" else "shows a"} record button"
            return@runOnMainSync
          }
          if (!wanted) return@runOnMainSync
          val target = (48 * themed.resources.displayMetrics.density).roundToInt()
          if (button.width != target || button.height != target) {
            failures += "$name: record button is ${button.width}x${button.height}px, " +
              "not ${target}px square"
          }
          if (button.contentDescription.isNullOrEmpty()) {
            failures += "$name: record button says nothing"
          }
          if (!button.hasOnClickListeners()) failures += "$name: record button opens nothing"
        }
      }
    }
    assertEquals(
      "Record button faults:\n" + failures.joinToString("\n"), emptyList<String>(), failures)
  }

  /**
   * Scenario: the Summary widget is placed two cells square, and one row tall at two and at four
   * cells wide, with the sample library and with the longest words the locales have.
   *
   * Expected behaviour: the hero's name is drawn on the line its value is drawn on, so the number
   * never stands alone, and the refresh control is drawn only where the row has room for it and
   * the numbers are the athlete's own.
   */
  @Test
  fun smallAndShortSummaryNameTheirHeroBesideItsValue() {
    val widget = widgets.first { it.name == "summary" }
    val failures = mutableListOf<String>()
    for (fixture in listOf("demo", "long-text", "no-wellness")) {
      val snap = snapshot(fixture)
      val label = SummaryWidget.card(snap, SummaryPlacement()).hero.label
      for (cells in listOf(Cells(2, 2), Cells(2, 1), Cells(3, 1), Cells(4, 1))) {
        val name = "summary-${cells.cols}x${cells.rows}-$fixture"
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
          val (w, h) = widthAndReportedHeight(cells)
          val host = place(widget.render(themed(false), snap, w, h), themed(false), cells)
          val drawn = host.findViewById<TextView>(R.id.sum_label)
          val value = host.findViewById<TextView>(R.id.sum_value)
          if (drawn == null || value == null || drawn !in shown(host) || drawn.text.toString() != label) {
            failures += "$name: draws no \"$label\""
            return@runOnMainSync
          }
          val a = bounds(drawn, host)
          val b = bounds(value, host)
          if (a.bottom <= b.top || b.bottom <= a.top) {
            failures += "$name: \"$label\" is not on the value's line"
          }
          inspect(host, name, failures)
          val control = host.findViewById<View>(R.id.widget_refresh)
          val showsControl = control != null && control in shown(host)
          val sample = snap.demoLabel != null || snap.emptyLibrary
          if (showsControl != (SummaryWidget.showsRefresh(w) && !sample)) {
            failures += "$name: refresh control shown is $showsControl"
          }
        }
      }
    }
    assertEquals(
      "Small and Short faults:\n" + failures.joinToString("\n"), emptyList<String>(), failures)
  }

  /** [view]'s box in [host]'s coordinates. */
  private fun bounds(view: View, host: View): Rect {
    val rect = Rect(0, 0, view.width, view.height)
    (host as ViewGroup).offsetDescendantRectToMyCoords(view, rect)
    return rect
  }

  /** Marks a native refresh as running, the way a tap on the control does, or clears it. */
  private fun setBusy(busy: Boolean) {
    val prefs =
      context.applicationContext.getSharedPreferences("native-widget-refresh", Context.MODE_PRIVATE)
    val edit = prefs.edit()
    if (busy) edit.putLong("startedAtElapsed", SystemClock.elapsedRealtime())
    else edit.remove("startedAtElapsed")
    edit.commit()
  }

  private fun fontScaled(base: Context, scale: Float): Context {
    val config = Configuration(base.resources.configuration)
    config.fontScale = scale
    return base.createConfigurationContext(config)
  }

  /** [view] and every visible view under it. */
  private fun shown(view: View): List<View> =
    when {
      view.visibility != View.VISIBLE -> emptyList()
      view is ViewGroup ->
        listOf(view) + (0 until view.childCount).flatMap { shown(view.getChildAt(it)) }
      else -> listOf(view)
    }

  /** What a launcher reports for [cells]: the width in portrait and the height in landscape. */
  private fun widthAndReportedHeight(cells: Cells): Pair<Int, Int> =
    Pair(73 * cells.cols - 16, 66 * cells.rows - 15)

  /** Walks two trees of one layout side by side and lists each view whose colours differ. */
  private fun compareColours(kept: View, fresh: View, name: String, found: MutableList<String>) {
    if (kept.visibility != View.VISIBLE || fresh.visibility != View.VISIBLE) return
    if (kept is TextView && fresh is TextView && kept.currentTextColor != fresh.currentTextColor) {
      found += "$name: ${label(kept)} text is #%08X, not #%08X".format(
        kept.currentTextColor, fresh.currentTextColor)
    }
    if (kept is ImageView && fresh is ImageView && !drawn(kept).sameAs(drawn(fresh))) {
      found += "$name: ${label(kept)} draws other colours"
    }
    if (kept is ViewGroup && fresh is ViewGroup) {
      for (i in 0 until min(kept.childCount, fresh.childCount)) {
        compareColours(kept.getChildAt(i), fresh.getChildAt(i), name, found)
      }
    }
  }

  private fun drawn(view: View): Bitmap {
    val bitmap =
      Bitmap.createBitmap(max(view.width, 1), max(view.height, 1), Bitmap.Config.ARGB_8888)
    view.draw(Canvas(bitmap))
    return bitmap
  }

  /** The bytes of every bitmap the shown images hold. */
  private fun imageBytes(view: View): Long =
    when {
      view.visibility != View.VISIBLE -> 0L
      view is ImageView ->
        ((view.drawable as? BitmapDrawable)?.bitmap?.allocationByteCount ?: 0).toLong()
      view is ViewGroup -> (0 until view.childCount).sumOf { imageBytes(view.getChildAt(it)) }
      else -> 0L
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
    // A line broken at a space keeps the space at its end, undrawn, so the drawn width is the
    // line's extent without its trailing whitespace.
    for (line in 0 until shown) {
      if (layout.getLineMax(line) > max(across, 0) + 1) {
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
