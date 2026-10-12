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
import __PKG__.R
import java.time.ZoneId
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Builds the RemoteViews for a Summary widget instance from the snapshot. Picks a layout by the
 * host-reported cell size and binds pre-formatted strings; no computation, no i18n. What each
 * size draws is decided in [SummaryWidget], so this only places it: the hero, its line and chart,
 * the supporting row on Medium and Large, and form over its five zones on Large. Dynamic colours
 * come from the generated `widget_*` resources and go on through [WidgetPalette], which carries
 * the light and the dark value of each. Form values are coloured by the snapshot's zone enum; the
 * widget never derives TSB boundaries.
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
    placement: SummaryPlacement,
    widgetId: Int,
  ): RemoteViews {
    val p = WidgetPalette(context)
    if (snap == null || isEmpty(snap)) return renderEmptyPrompt(context, p)
    val card = SummaryWidget.card(snap, placement)
    return when (SummaryWidget.sizeFor(minWidthDp, minHeightDp)) {
      SummarySize.LARGE -> renderLarge(context, p, snap, card, minWidthDp, widgetId)
      SummarySize.MEDIUM -> renderMedium(context, p, snap, card, minWidthDp, widgetId)
      SummarySize.SMALL -> renderSmall(context, p, snap, card, minWidthDp, widgetId)
      SummarySize.SHORT -> renderShort(context, p, snap, card, widgetId)
    }
  }

  /** One row tall: the hero, its trend and its line, with no room left for the chart or the age. */
  private fun renderShort(
    context: Context,
    p: WidgetPalette,
    snap: WidgetSnapshot,
    card: SummaryCard,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_small)
    bindHero(p, v, snap, card)
    v.setViewVisibility(R.id.sum_sparkline, View.GONE)
    v.setViewVisibility(R.id.small_age, View.GONE)
    bindFitnessTap(context, v, widgetId)
    return v
  }

  private fun renderSmall(
    context: Context,
    p: WidgetPalette,
    snap: WidgetSnapshot,
    card: SummaryCard,
    minWidthDp: Int,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_small)
    bindHero(p, v, snap, card)
    bindChart(context, p, v, snap, card, chartWidthDp(minWidthDp, 140), 40)
    bindFitnessTap(context, v, widgetId)
    // A host reapplies these views over the ones it shows, which a short placement left hidden.
    v.setViewVisibility(R.id.small_age, View.VISIBLE)
    bindUpdatedAt(p, v, R.id.small_updated, snap)
    bindRefresh(context, v, snap)
    return v
  }

  private fun renderMedium(
    context: Context,
    p: WidgetPalette,
    snap: WidgetSnapshot,
    card: SummaryCard,
    minWidthDp: Int,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_medium)
    bindHero(p, v, snap, card)
    bindSupporting(p, v, snap, SummaryWidget.supporting(card, SummarySize.MEDIUM))
    val chartW = ((chartWidthDp(minWidthDp, 300) - 8) / 2).coerceAtLeast(120)
    bindChart(context, p, v, snap, card, chartW, 48)
    bindFitnessTap(context, v, widgetId)
    bindUpdatedAt(p, v, R.id.med_updated, snap)
    bindRefresh(context, v, snap)
    return v
  }

  private fun renderLarge(
    context: Context,
    p: WidgetPalette,
    snap: WidgetSnapshot,
    card: SummaryCard,
    minWidthDp: Int,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_large)
    bindHero(p, v, snap, card)
    bindSupporting(p, v, snap, SummaryWidget.supporting(card, SummarySize.LARGE))
    val chartW = ((chartWidthDp(minWidthDp, 300) - 8) / 2).coerceAtLeast(120)
    bindChart(context, p, v, snap, card, chartW, 52)
    bindFormZones(context, p, v, snap, chartWidthDp(minWidthDp, 300), 96)

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
    bindUpdatedAt(p, v, R.id.large_updated, snap)
    bindRefresh(context, v, snap)
    return v
  }

  private fun bindHero(p: WidgetPalette, v: RemoteViews, snap: WidgetSnapshot, card: SummaryCard) {
    val color = summaryColor(p, card.hero.colorKey, snap.form.zone)
    v.setTextViewText(R.id.sum_label, card.hero.label)
    v.setTextViewText(R.id.sum_value, card.hero.value)
    p.textColor(v, R.id.sum_value, color)
    v.setTextViewText(R.id.sum_trend, SummaryWidget.trendArrow(card.hero.trendDir))
    p.textColor(v, R.id.sum_trend, trendColor(card.hero.verdict))
    // The arrow carries the verdict in colour, so the row is read as the engine's words for it.
    v.setContentDescription(R.id.sum_hero, card.hero.spokenOrPlain())
    val line = SummaryWidget.heroLine(snap, card)
    if (line.isNullOrEmpty()) {
      v.setViewVisibility(R.id.sum_line, View.GONE)
    } else {
      v.setViewVisibility(R.id.sum_line, View.VISIBLE)
      v.setTextViewText(R.id.sum_line, line)
      p.textColor(v, R.id.sum_line, color)
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
    p: WidgetPalette,
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
      p.textColor(v, ids.value, summaryColor(p, entry.colorKey, snap.form.zone))
      v.setTextViewText(ids.trend, SummaryWidget.trendArrow(entry.trendDir))
      p.textColor(v, ids.trend, trendColor(entry.verdict))
      v.setContentDescription(ids.cell, entry.spokenOrPlain())
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
  internal fun bindUpdatedAt(p: WidgetPalette, v: RemoteViews, id: Int, snap: WidgetSnapshot?) {
    // A sample library has no age to report: it is composed afresh for every
    // write, so the slot carries the words that say it is not the athlete's own.
    snap?.demoLabel?.let {
      v.setViewVisibility(id, View.VISIBLE)
      v.setTextViewText(id, it)
      p.textColor(v, id, R.color.widget_text_secondary)
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
        p.textColor(v, id, R.color.widget_text_secondary)
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
    p.textColor(v, id, if (stale) R.color.widget_warning else R.color.widget_text_secondary)
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
    p: WidgetPalette,
    layout: Int = R.layout.widget_activity_small,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, layout)
    v.setViewVisibility(R.id.act_name, View.VISIBLE)
    v.setTextViewText(R.id.act_name, context.getString(R.string.widget_open_app))
    p.textColor(v, R.id.act_name, R.color.widget_text_primary)
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
    val p = WidgetPalette(context)
    val size = LastActivityWidget.sizeFor(minWidthDp, minHeightDp)
    val narrow = size == SummarySize.SHORT || size == SummarySize.SMALL
    val layout = if (narrow) R.layout.widget_activity_small else R.layout.widget_activity_medium
    val content = snap?.let { LastActivityWidget.content(it, size) }
    val latest = snap?.latest
    if (snap == null || content == null || latest == null) {
      return renderEmptyPrompt(context, p, layout)
    }

    val v = RemoteViews(context.packageName, layout)
    val d = context.resources.displayMetrics.density
    val tint = tintOrDefault(p, latest.tintHex)

    bindLine(v, R.id.act_name, content.name)
    p.textColor(v, R.id.act_name, tint)
    // The tall size has the rows for a long name to wrap into rather than be cut short.
    v.setInt(R.id.act_name, "setMaxLines", if (size == SummarySize.LARGE) 4 else 2)
    v.setViewVisibility(
      R.id.act_pr, if (content.isPr && content.name != null) View.VISIBLE else View.GONE)
    v.setContentDescription(R.id.act_pr, latest.prLabel)
    bindLine(v, R.id.act_label, content.heroLabel)
    bindLine(v, R.id.act_hero, content.hero)
    bindLine(v, R.id.act_detail, content.detail)
    bindLine(v, R.id.act_sub, content.figures)
    bindLine(v, R.id.act_prs, content.sectionPrs)
    bindLine(v, R.id.act_load, content.load)
    bindLine(v, R.id.act_date, content.date)
    bindLine(v, R.id.act_demo, snap.demoLabel.takeUnless { size == SummarySize.SHORT })
    bindFormChange(p, v, content.form)

    val columnDp = if (narrow) minWidthDp - 16 else (minWidthDp - 40) / 2
    if (content.dots.isEmpty()) {
      v.setViewVisibility(R.id.act_dots, View.GONE)
    } else {
      val earlier = p.color(R.color.widget_text_secondary)
      val record = p.color(R.color.widget_gold)
      p.bitmap(v, R.id.act_dots) { dark ->
        AttemptDotsBitmap.render(
          content.dots,
          (columnDp.coerceAtLeast(40) * d).roundToInt(),
          (10 * d).roundToInt(),
          AttemptDotsBitmap.Colors(earlier.pick(dark), record.pick(dark), tint.pick(dark)))
      }
      v.setViewVisibility(R.id.act_dots, View.VISIBLE)
    }

    val preview = latest.routePreview
    if (!content.showsRoute || preview == null) {
      v.setViewVisibility(R.id.act_preview, View.GONE)
    } else {
      val heightDp = (if (minHeightDp > 0) minHeightDp else 110) - 16
      p.bitmap(v, R.id.act_preview) { dark ->
        RoutePreviewBitmap.render(
          preview,
          (columnDp.coerceAtLeast(60) * d).roundToInt(),
          (heightDp.coerceAtLeast(60) * d).roundToInt(),
          tint.pick(dark))
      }
      v.setContentDescription(R.id.act_preview, latest.routeLabel)
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
  private fun bindFormChange(p: WidgetPalette, v: RemoteViews, form: FormChange?) {
    if (form == null) {
      v.setViewVisibility(R.id.act_form, View.GONE)
      return
    }
    v.setViewVisibility(R.id.act_form, View.VISIBLE)
    v.setTextViewText(R.id.act_form_label, form.label)
    v.setTextViewText(R.id.act_form_arrow, "→")
    v.setTextViewText(R.id.act_form_before, form.before)
    p.textColor(v, R.id.act_form_before, zoneTextColor(form.beforeZone))
    v.setTextViewText(R.id.act_form_after, form.after)
    p.textColor(v, R.id.act_form_after, zoneTextColor(form.afterZone))
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

  private fun chartColors(p: WidgetPalette, dark: Boolean) =
    FitnessChart.ChartColors(
      fitness = p.color(R.color.widget_chart_fitness).pick(dark),
      fatigue = p.color(R.color.widget_chart_fatigue).pick(dark),
      casing = p.color(R.color.widget_chart_casing).pick(dark),
      axisText = p.color(R.color.widget_text_secondary).pick(dark),
      grid = p.color(R.color.widget_border).pick(dark),
    )

  /** The chart beside the hero, or nothing when the card hides it or the series is too short. */
  private fun bindChart(
    context: Context,
    p: WidgetPalette,
    v: RemoteViews,
    snap: WidgetSnapshot,
    card: SummaryCard,
    widthDp: Int,
    heightDp: Int,
  ) {
    val d = context.resources.displayMetrics.density
    val w = (widthDp * d).roundToInt()
    val h = (heightDp * d).roundToInt()
    val chart = SummaryWidget.chart(snap, card)
    val primary = p.color(R.color.widget_primary)
    fun draw(dark: Boolean) =
      when (chart) {
        is SummaryChart.Dual ->
          FitnessChart.fitnessBitmap(chart.fitness, chart.fatigue, w, h, d, chartColors(p, dark))
        is SummaryChart.Single ->
          FitnessChart.singleBitmap(chart.values, primary.pick(dark), w, h, d, chartColors(p, dark))
        SummaryChart.None -> null
      }
    // Whether a series draws at all does not depend on the theme, so the light one decides.
    val light = draw(false)
    if (light == null) {
      v.setViewVisibility(R.id.sum_sparkline, View.GONE)
    } else {
      p.bitmap(v, R.id.sum_sparkline) { dark -> if (dark) draw(true) ?: light else light }
      v.setContentDescription(
        R.id.sum_sparkline,
        if (chart is SummaryChart.Single) snap.chartLabels.hrv else snap.chartLabels.fitness)
      v.setViewVisibility(R.id.sum_sparkline, View.VISIBLE)
    }
  }

  /** Form over its five zones under the card, hidden with its title when the snapshot has none. */
  private fun bindFormZones(
    context: Context,
    p: WidgetPalette,
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
    fun colors(dark: Boolean) =
      FitnessChart.ZoneColors(
        zones =
          mapOf(
            "highRisk" to p.color(R.color.widget_form_high_risk).pick(dark),
            "optimal" to p.color(R.color.widget_form_optimal).pick(dark),
            "greyZone" to p.color(R.color.widget_form_grey_zone).pick(dark),
            "fresh" to p.color(R.color.widget_form_fresh).pick(dark),
            "transition" to p.color(R.color.widget_form_transition).pick(dark),
          ),
        line = p.color(R.color.widget_text_primary).pick(dark),
        casing = p.color(R.color.widget_chart_casing).pick(dark),
        axisText = p.color(R.color.widget_text_secondary).pick(dark),
      )
    v.setViewVisibility(R.id.sum_form_title, View.VISIBLE)
    v.setTextViewText(R.id.sum_form_title, snap.metricLabels["form"] ?: "Form")
    v.setViewVisibility(R.id.sum_form_zones, View.VISIBLE)
    v.setContentDescription(R.id.sum_form_zones, snap.chartLabels.form)
    p.bitmap(v, R.id.sum_form_zones) { dark ->
      FitnessChart.formZonesBitmap(
        chart, (widthDp * d).roundToInt(), (heightDp * d).roundToInt(), d, colors(dark))
    }
  }

  // ---- formatting -------------------------------------------------------------

  /** Coloured by the judgement the app made, never by the direction the number went. */
  private fun trendColor(verdict: String): Int =
    when (verdict) {
      "improved" -> R.color.widget_trend_up
      "declined" -> R.color.widget_trend_down
      else -> R.color.widget_trend_flat
    }

  /**
   * Text: the hero value and the impact numbers, which the widget draws with no
   * zone label beside them, so the fill's 2.1:1 to 2.7:1 is all the reader gets.
   */
  private fun zoneTextColor(zone: String?): Int =
    when (zone) {
      "highRisk" -> R.color.widget_form_high_risk_text
      "optimal" -> R.color.widget_form_optimal_text
      "greyZone" -> R.color.widget_form_grey_zone_text
      "fresh" -> R.color.widget_form_fresh_text
      "transition" -> R.color.widget_form_transition_text
      else -> R.color.widget_text_primary
    }

  private fun summaryColor(p: WidgetPalette, colorKey: String, formZone: String?): ThemedColor =
    p.color(
      when (colorKey) {
        "blue" -> R.color.widget_blue
        "fatigue" -> R.color.widget_fatigue
        "formZone" -> zoneTextColor(formZone)
        else -> R.color.widget_text_primary
      })

  /** An activity's own colour, the same in both themes; an unreadable one is the text colour. */
  private fun tintOrDefault(p: WidgetPalette, hex: String): ThemedColor =
    try {
      ThemedColor.fixed(Color.parseColor(hex))
    } catch (_: Exception) {
      p.color(R.color.widget_text_primary)
    }
}
