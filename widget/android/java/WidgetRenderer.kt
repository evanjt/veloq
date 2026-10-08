package __PKG__.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.text.format.DateUtils
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import __PKG__.R
import java.time.ZoneId
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Builds the RemoteViews for a Summary widget instance from the snapshot. Picks a layout by the
 * host-reported cell size and binds pre-formatted strings; no computation, no i18n. What each
 * size draws is decided in [SummaryWidget], so this only places it: the hero, its line and chart,
 * the supporting row on Medium and Large, and form over its five zones on Large. Dynamic colours
 * come from the generated `widget_*` resources (auto light/dark). Form values are coloured by the
 * snapshot's zone enum; the widget never derives TSB boundaries.
 *
 * The card opens Fitness; the age row's refresh control queues native work.
 */
object WidgetRenderer {
  /** Where a tap on the Summary widget goes. */
  const val FITNESS_URL = "veloq://fitness"

  fun render(
    context: Context,
    snap: WidgetSnapshot?,
    minWidthDp: Int,
    minHeightDp: Int,
    heroChoice: String?,
    widgetId: Int,
  ): RemoteViews {
    if (snap == null || isEmpty(snap)) return renderEmptyPrompt(context)
    val card = SummaryWidget.card(snap, heroChoice)
    return when (SummaryWidget.sizeFor(minWidthDp, minHeightDp)) {
      SummarySize.LARGE -> renderLarge(context, snap, card, minWidthDp, widgetId)
      SummarySize.MEDIUM -> renderMedium(context, snap, card, minWidthDp, widgetId)
      SummarySize.SMALL -> renderSmall(context, snap, card, minWidthDp, widgetId)
      SummarySize.SHORT -> renderShort(context, snap, card, widgetId)
    }
  }

  /** One row tall: the hero, its trend and its line, with no room left for the chart or the age. */
  private fun renderShort(
    context: Context,
    snap: WidgetSnapshot,
    card: SummaryCard,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_small)
    bindHero(context, v, snap, card)
    v.setViewVisibility(R.id.sum_sparkline, View.GONE)
    v.setViewVisibility(R.id.small_age, View.GONE)
    bindFitnessTap(context, v, widgetId)
    return v
  }

  private fun renderSmall(
    context: Context,
    snap: WidgetSnapshot,
    card: SummaryCard,
    minWidthDp: Int,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_small)
    bindHero(context, v, snap, card)
    bindChart(context, v, R.id.sum_sparkline, snap, card, chartWidthDp(minWidthDp, 140), 40)
    bindFitnessTap(context, v, widgetId)
    // A host reapplies these views over the ones it shows, which a short placement left hidden.
    v.setViewVisibility(R.id.small_age, View.VISIBLE)
    bindUpdatedAt(context, v, R.id.small_updated, snap)
    bindRefresh(context, v, snap)
    return v
  }

  private fun renderMedium(
    context: Context,
    snap: WidgetSnapshot,
    card: SummaryCard,
    minWidthDp: Int,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_medium)
    bindHero(context, v, snap, card)
    bindSupporting(context, v, snap, SummaryWidget.supporting(card, SummarySize.MEDIUM))
    val chartW = ((chartWidthDp(minWidthDp, 300) - 8) / 2).coerceAtLeast(120)
    bindChart(context, v, R.id.sum_sparkline, snap, card, chartW, 48)
    bindFitnessTap(context, v, widgetId)
    bindUpdatedAt(context, v, R.id.med_updated, snap)
    bindRefresh(context, v, snap)
    return v
  }

  private fun renderLarge(
    context: Context,
    snap: WidgetSnapshot,
    card: SummaryCard,
    minWidthDp: Int,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_large)
    bindHero(context, v, snap, card)
    bindSupporting(context, v, snap, SummaryWidget.supporting(card, SummarySize.LARGE))
    val chartW = ((chartWidthDp(minWidthDp, 300) - 8) / 2).coerceAtLeast(120)
    bindChart(context, v, R.id.sum_sparkline, snap, card, chartW, 52)
    bindFormZones(context, v, snap, chartWidthDp(minWidthDp, 300), 96)

    // One gate with the standalone Quick-Record widget: INCLUDE_RECORD_WIDGET in
    // with-android-widget.js writes this bool and drops that receiver together.
    // On since 2026-09-08, so the branch is the off switch rather than the state.
    if (context.resources.getBoolean(R.bool.widget_record_enabled)) {
      v.setViewVisibility(R.id.large_record, View.VISIBLE)
      v.setOnClickPendingIntent(R.id.large_record, recordIntent(context, snap))
      v.setContentDescription(R.id.large_record, snap.recordLabel)
    } else {
      v.setViewVisibility(R.id.large_record, View.GONE)
    }
    bindFitnessTap(context, v, widgetId)
    bindUpdatedAt(context, v, R.id.large_updated, snap)
    bindRefresh(context, v, snap)
    return v
  }

  private fun bindHero(context: Context, v: RemoteViews, snap: WidgetSnapshot, card: SummaryCard) {
    val color = summaryColor(context, card.hero.colorKey, snap.form.zone)
    v.setTextViewText(R.id.sum_label, card.hero.label)
    v.setTextViewText(R.id.sum_value, card.hero.value)
    v.setTextColor(R.id.sum_value, color)
    v.setTextViewText(R.id.sum_trend, trendArrow(card.hero.trendDir))
    v.setTextColor(R.id.sum_trend, trendColor(context, card.hero.verdict))
    val line = SummaryWidget.heroLine(snap, card)
    if (line.isNullOrEmpty()) {
      v.setViewVisibility(R.id.sum_line, View.GONE)
    } else {
      v.setViewVisibility(R.id.sum_line, View.VISIBLE)
      v.setTextViewText(R.id.sum_line, line)
      v.setTextColor(R.id.sum_line, color)
    }
  }

  private class CellIds(
    val cell: Int,
    val divider: Int?,
    val label: Int,
    val value: Int,
    val trend: Int,
  )

  private val CELL_IDS =
    arrayOf(
      CellIds(R.id.sum_cell0, null, R.id.sum_cell0_label, R.id.sum_cell0_value, R.id.sum_cell0_trend),
      CellIds(R.id.sum_cell1, R.id.sum_div1, R.id.sum_cell1_label, R.id.sum_cell1_value, R.id.sum_cell1_trend),
      CellIds(R.id.sum_cell2, R.id.sum_div2, R.id.sum_cell2_label, R.id.sum_cell2_value, R.id.sum_cell2_trend),
      CellIds(R.id.sum_cell3, R.id.sum_div3, R.id.sum_cell3_label, R.id.sum_cell3_value, R.id.sum_cell3_trend),
    )

  /** One cell per entry, a divider before every cell but the first, nothing for the rest. */
  private fun bindSupporting(
    context: Context,
    v: RemoteViews,
    snap: WidgetSnapshot,
    entries: List<SummaryEntry>,
  ) {
    for ((i, ids) in CELL_IDS.withIndex()) {
      val entry = entries.getOrNull(i)
      val visibility = if (entry == null) View.GONE else View.VISIBLE
      v.setViewVisibility(ids.cell, visibility)
      ids.divider?.let { v.setViewVisibility(it, visibility) }
      if (entry == null) continue
      v.setTextViewText(ids.label, entry.label)
      v.setTextViewText(ids.value, entry.value)
      v.setTextColor(ids.value, summaryColor(context, entry.colorKey, snap.form.zone))
      v.setTextViewText(ids.trend, trendArrow(entry.trendDir))
      v.setTextColor(ids.trend, trendColor(context, entry.verdict))
    }
  }

  /**
   * How old the numbers are, as the system phrases it.
   *
   * The widget is stale exactly for the athlete whose app has not run, and the
   * numbers on it give no clue how old they are. The line is computed at render
   * rather than carried in the payload: a pre-formatted "just now" written at
   * save time would still say "just now" a day later.
   *
   * It counts from [SnapshotAge.reference]: the last sync on a snapshot redrawn
   * from stored rows after a pull that did not land, which then leads with the
   * words that say so, else the write time. A snapshot with neither hides the
   * line, or shows those words alone, rather than saying 1970.
   *
   * Past [SnapshotAge.STALE_AFTER_SECONDS] the line is amber and names the time
   * it counts from. [VeloqWidgetProvider] keeps it true between snapshots by
   * asking for a redraw on a schedule, since nothing else redraws a widget whose
   * app is not running.
   */
  internal fun bindUpdatedAt(context: Context, v: RemoteViews, id: Int, snap: WidgetSnapshot?) {
    // A sample library has no age to report: it is composed afresh for every
    // write, so the slot carries the words that say it is not the athlete's own.
    snap?.demoLabel?.let {
      v.setViewVisibility(id, View.VISIBLE)
      v.setTextViewText(id, it)
      v.setTextColor(id, res(context, R.color.widget_text_secondary))
      return
    }
    val asOf = snap?.dataAsOfLabel
    val seconds = SnapshotAge.reference(snap)
    if (seconds == null) {
      if (asOf == null) {
        v.setViewVisibility(id, View.GONE)
      } else {
        v.setViewVisibility(id, View.VISIBLE)
        v.setTextViewText(id, asOf)
        v.setTextColor(id, res(context, R.color.widget_text_secondary))
      }
      return
    }
    val now = System.currentTimeMillis()
    val stale = SnapshotAge.isStale(seconds, now)
    val age =
      if (stale) {
        SnapshotAge.absolute(seconds, ZoneId.systemDefault(), Locale.getDefault())
      } else {
        DateUtils.getRelativeTimeSpanString(
          seconds * 1000L, now, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE)
      }
    v.setViewVisibility(id, View.VISIBLE)
    v.setTextViewText(id, if (asOf == null) age else "$asOf · $age")
    v.setTextColor(
      id, res(context, if (stale) R.color.widget_warning else R.color.widget_text_secondary))
  }

  /** The age and the action share a row; the action keeps a full finger-sized target. */
  internal fun bindRefresh(context: Context, v: RemoteViews, snap: WidgetSnapshot?) {
    if (snap == null || snap.emptyLibrary || snap.demoLabel != null) {
      v.setViewVisibility(R.id.widget_refresh, View.GONE)
      return
    }
    v.setViewVisibility(R.id.widget_refresh, View.VISIBLE)
    val busy = com.veloq.NativeWidgetSnapshot.isBusy(context)
    v.setTextViewText(R.id.widget_refresh, if (busy) "…" else "↻")
    v.setContentDescription(
      R.id.widget_refresh,
      if (busy) snap?.refreshingLabel ?: context.getString(R.string.widget_refreshing)
      else snap?.refreshLabel ?: context.getString(R.string.widget_refresh))
    v.setOnClickPendingIntent(
      R.id.widget_refresh,
      PendingIntent.getBroadcast(
        context, 40,
        Intent(context, VeloqWidgetProvider::class.java).setAction(VeloqWidgetProvider.ACTION_REFRESH),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
  }

  // ---- latest activity widget ---------------------------------------------------

  /**
   * A text card nudging into the app, the same wording as iOS. It shows before
   * any snapshot exists, so its text is the generated string resources rather
   * than the snapshot's.
   */
  private fun renderEmptyPrompt(
    context: Context,
    layout: Int = R.layout.widget_activity_small,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, layout)
    v.setViewVisibility(R.id.act_name, View.VISIBLE)
    v.setTextViewText(R.id.act_name, context.getString(R.string.widget_open_app))
    v.setTextColor(R.id.act_name, res(context, R.color.widget_text_primary))
    v.setViewVisibility(R.id.act_sub, View.VISIBLE)
    v.setTextViewText(R.id.act_sub, context.getString(R.string.widget_to_see_training))
    v.setViewVisibility(R.id.act_preview, View.GONE)
    v.setViewVisibility(R.id.act_pr, View.GONE)
    v.setOnClickPendingIntent(R.id.act_root, deepLink(context, "veloq://", 3))
    return v
  }

  private fun isEmpty(snap: WidgetSnapshot?): Boolean = WidgetSnapshot.showsEmptyPrompt(snap)

  /**
   * The Last activity widget. [LastActivityWidget] decides which lines a size has room for; this
   * places them, scales the route to the half it is drawn in, and paints the attempt dots.
   */
  fun renderActivity(
    context: Context,
    snap: WidgetSnapshot?,
    minWidthDp: Int,
    minHeightDp: Int,
  ): RemoteViews {
    val size = LastActivityWidget.sizeFor(minWidthDp, minHeightDp)
    val narrow = size == SummarySize.SHORT || size == SummarySize.SMALL
    val layout = if (narrow) R.layout.widget_activity_small else R.layout.widget_activity_medium
    val content = snap?.let { LastActivityWidget.content(it, size) }
    val latest = snap?.latest
    if (snap == null || content == null || latest == null) return renderEmptyPrompt(context, layout)

    val v = RemoteViews(context.packageName, layout)
    val d = context.resources.displayMetrics.density
    val tint = tintOrDefault(context, latest.tintHex)

    bindLine(v, R.id.act_name, content.name)
    v.setTextColor(R.id.act_name, tint)
    // The tall size has the rows for a long name to wrap into rather than be cut short.
    v.setInt(R.id.act_name, "setMaxLines", if (size == SummarySize.LARGE) 4 else 2)
    v.setViewVisibility(
      R.id.act_pr, if (content.isPr && content.name != null) View.VISIBLE else View.GONE)
    bindLine(v, R.id.act_label, content.heroLabel)
    bindLine(v, R.id.act_hero, content.hero)
    bindLine(v, R.id.act_detail, content.detail)
    bindLine(v, R.id.act_sub, content.figures)
    bindLine(v, R.id.act_prs, content.sectionPrs)
    bindLine(v, R.id.act_load, content.load)
    bindLine(v, R.id.act_date, content.date)
    bindLine(v, R.id.act_demo, snap.demoLabel.takeUnless { size == SummarySize.SHORT })
    bindFormChange(context, v, content.form)

    val columnDp = if (narrow) minWidthDp - 16 else (minWidthDp - 40) / 2
    if (content.dots.isEmpty()) {
      v.setViewVisibility(R.id.act_dots, View.GONE)
    } else {
      val colors =
        AttemptDotsBitmap.Colors(
          earlier = res(context, R.color.widget_text_secondary),
          record = res(context, R.color.widget_gold),
          current = tint)
      v.setImageViewBitmap(
        R.id.act_dots,
        AttemptDotsBitmap.render(
          content.dots, (columnDp.coerceAtLeast(40) * d).roundToInt(), (10 * d).roundToInt(), colors))
      v.setViewVisibility(R.id.act_dots, View.VISIBLE)
    }

    val preview = latest.routePreview
    if (!content.showsRoute || preview == null) {
      v.setViewVisibility(R.id.act_preview, View.GONE)
    } else {
      val heightDp = (if (minHeightDp > 0) minHeightDp else 110) - 16
      val bmp =
        RoutePreviewBitmap.render(
          preview,
          (columnDp.coerceAtLeast(60) * d).roundToInt(),
          (heightDp.coerceAtLeast(60) * d).roundToInt(),
          tint)
      v.setImageViewBitmap(R.id.act_preview, bmp)
      v.setViewVisibility(R.id.act_preview, View.VISIBLE)
    }

    val url = latest.activityId?.let { "veloq://activity/$it" } ?: "veloq://"
    v.setOnClickPendingIntent(R.id.act_root, deepLink(context, url, 3))
    return v
  }

  /** A line of text, or nothing at all when there is none. */
  private fun bindLine(v: RemoteViews, id: Int, text: String?) {
    if (text.isNullOrEmpty()) {
      v.setViewVisibility(id, View.GONE)
    } else {
      v.setViewVisibility(id, View.VISIBLE)
      v.setTextViewText(id, text)
    }
  }

  /** Form before and after, each side in the colour of the zone it sits in. */
  private fun bindFormChange(context: Context, v: RemoteViews, form: FormChange?) {
    if (form == null) {
      v.setViewVisibility(R.id.act_form, View.GONE)
      return
    }
    v.setViewVisibility(R.id.act_form, View.VISIBLE)
    v.setTextViewText(R.id.act_form_label, form.label)
    v.setTextViewText(R.id.act_form_arrow, "→")
    v.setTextViewText(R.id.act_form_before, form.before)
    v.setTextColor(R.id.act_form_before, zoneTextColor(context, form.beforeZone))
    v.setTextViewText(R.id.act_form_after, form.after)
    v.setTextColor(R.id.act_form_after, zoneTextColor(context, form.afterZone))
  }

  // ---- intents ------------------------------------------------------------------

  /**
   * A tap on record starts the ride, so it takes the deep link the snapshot
   * carries for the most recent sport. The picker is the fallback and nothing
   * else: with no sport known there is no recording screen to open.
   */
  const val RECORD_PICKER_URL = "veloq://record"

  fun recordUrl(snap: WidgetSnapshot?): String =
    snap?.launcherShortcuts?.firstOrNull()?.url ?: RECORD_PICKER_URL

  /** A configured instance keeps its own sport; an unconfigured one follows the last. */
  fun recordUrl(snap: WidgetSnapshot?, configured: String?): String =
    configured ?: recordUrl(snap)

  fun recordIntent(context: Context, snap: WidgetSnapshot?): PendingIntent =
    deepLink(context, recordUrl(snap), 0)

  fun recordIntent(
    context: Context,
    snap: WidgetSnapshot?,
    configured: String?,
    requestCode: Int
  ): PendingIntent = deepLink(context, recordUrl(snap, configured), requestCode)

  internal fun deepLink(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent =
      Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        `package` = context.packageName
      }
    // The record URL follows the last sport, so a cached intent for one request
    // code has to be rewritten rather than handed back with its old data.
    return PendingIntent.getActivity(
      context, requestCode, intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /** The card surface opens Fitness; an instance the host has not numbered yet gets no tap. */
  private fun bindFitnessTap(context: Context, v: RemoteViews, widgetId: Int) {
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
    v.setOnClickPendingIntent(R.id.sum_root, deepLink(context, FITNESS_URL, 4))
  }

  // ---- shared binding helpers -------------------------------------------------

  // Launchers can report 0 before the first options callback; fall back per size.
  private fun chartWidthDp(minWidthDp: Int, fallbackDp: Int): Int =
    (if (minWidthDp > 0) minWidthDp else fallbackDp) - 32

  private fun chartColors(context: Context) =
    FitnessChart.ChartColors(
      fitness = res(context, R.color.widget_chart_fitness),
      fatigue = res(context, R.color.widget_chart_fatigue),
      casing = res(context, R.color.widget_chart_casing),
      axisText = res(context, R.color.widget_text_secondary),
      grid = res(context, R.color.widget_border),
    )

  /** The chart beside the hero, or nothing when the card hides it or the series is too short. */
  private fun bindChart(
    context: Context,
    v: RemoteViews,
    id: Int,
    snap: WidgetSnapshot,
    card: SummaryCard,
    widthDp: Int,
    heightDp: Int,
  ) {
    val d = context.resources.displayMetrics.density
    val w = (widthDp * d).roundToInt()
    val h = (heightDp * d).roundToInt()
    val bmp =
      when (val chart = SummaryWidget.chart(snap, card)) {
        is SummaryChart.Dual ->
          FitnessChart.fitnessBitmap(chart.fitness, chart.fatigue, w, h, d, chartColors(context))
        is SummaryChart.Single ->
          FitnessChart.singleBitmap(
            chart.values, res(context, R.color.widget_primary), w, h, d, chartColors(context))
        SummaryChart.None -> null
      }
    if (bmp == null) {
      v.setViewVisibility(id, View.GONE)
    } else {
      v.setImageViewBitmap(id, bmp)
      v.setViewVisibility(id, View.VISIBLE)
    }
  }

  /** Form over its five zones under the card, hidden with its title when the snapshot has none. */
  private fun bindFormZones(
    context: Context,
    v: RemoteViews,
    snap: WidgetSnapshot,
    widthDp: Int,
    heightDp: Int,
  ) {
    val chart = SummaryWidget.formZones(snap)
    if (chart == null) {
      v.setViewVisibility(R.id.sum_form_title, View.GONE)
      v.setViewVisibility(R.id.sum_form_zones, View.GONE)
      return
    }
    val d = context.resources.displayMetrics.density
    val colors =
      FitnessChart.ZoneColors(
        zones =
          mapOf(
            "highRisk" to res(context, R.color.widget_form_high_risk),
            "optimal" to res(context, R.color.widget_form_optimal),
            "greyZone" to res(context, R.color.widget_form_grey_zone),
            "fresh" to res(context, R.color.widget_form_fresh),
            "transition" to res(context, R.color.widget_form_transition),
          ),
        line = res(context, R.color.widget_text_primary),
        casing = res(context, R.color.widget_chart_casing),
        axisText = res(context, R.color.widget_text_secondary),
      )
    v.setViewVisibility(R.id.sum_form_title, View.VISIBLE)
    v.setTextViewText(R.id.sum_form_title, snap.metricLabels["form"] ?: "Form")
    v.setViewVisibility(R.id.sum_form_zones, View.VISIBLE)
    v.setImageViewBitmap(
      R.id.sum_form_zones,
      FitnessChart.formZonesBitmap(
        chart, (widthDp * d).roundToInt(), (heightDp * d).roundToInt(), d, colors))
  }

  // ---- formatting -------------------------------------------------------------

  private fun trendArrow(dir: String): String =
    when (dir) {
      "up" -> "▲"
      "down" -> "▼"
      else -> "–"
    }

  /** Coloured by the judgement the app made, never by the direction the number went. */
  private fun trendColor(context: Context, verdict: String): Int {
    val colorRes =
      when (verdict) {
        "improved" -> R.color.widget_trend_up
        "declined" -> R.color.widget_trend_down
        else -> R.color.widget_trend_flat
      }
    return res(context, colorRes)
  }

  /**
   * Text: the hero value and the impact numbers, which the widget draws with no
   * zone label beside them, so the fill's 2.1:1 to 2.7:1 is all the reader gets.
   */
  private fun zoneTextColor(context: Context, zone: String?): Int {
    val colorRes =
      when (zone) {
        "highRisk" -> R.color.widget_form_high_risk_text
        "optimal" -> R.color.widget_form_optimal_text
        "greyZone" -> R.color.widget_form_grey_zone_text
        "fresh" -> R.color.widget_form_fresh_text
        "transition" -> R.color.widget_form_transition_text
        else -> R.color.widget_text_primary
      }
    return res(context, colorRes)
  }

  private fun summaryColor(context: Context, colorKey: String, formZone: String?): Int =
    when (colorKey) {
      "blue" -> res(context, R.color.widget_blue)
      "fatigue" -> res(context, R.color.widget_fatigue)
      "formZone" -> zoneTextColor(context, formZone)
      else -> res(context, R.color.widget_text_primary)
    }

  internal fun res(context: Context, id: Int): Int = ContextCompat.getColor(context, id)

  private fun tintOrDefault(context: Context, hex: String): Int =
    try {
      Color.parseColor(hex)
    } catch (_: Exception) {
      res(context, R.color.widget_text_primary)
    }
}
