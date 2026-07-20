package __PKG__.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import __PKG__.R
import kotlin.math.roundToInt

/**
 * Builds the RemoteViews for a widget instance from the snapshot. Picks a layout by the
 * host-reported cell size and binds pre-formatted strings; no computation, no i18n.
 * Dynamic colours come from the generated `widget_*` resources (auto light/dark) plus
 * the snapshot's resolved activity tint. Form values are coloured by the snapshot's
 * zone enum; the widget never derives TSB boundaries.
 *
 * Small and Medium feature a hero metric chosen per widget instance: tapping the hero
 * broadcasts VeloqWidgetProvider.ACTION_CYCLE_METRIC, which cycles the stored key and
 * re-renders just that widget. "summary" mirrors the in-app summary card settings.
 */
object WidgetRenderer {
  private enum class Size {
    SMALL,
    MEDIUM,
    LARGE,
  }

  fun render(
    context: Context,
    snap: WidgetSnapshot?,
    minWidthDp: Int,
    minHeightDp: Int,
    heroKey: String,
    widgetId: Int,
  ): RemoteViews {
    return when (pickSize(minWidthDp, minHeightDp)) {
      Size.LARGE -> renderLarge(context, snap, minWidthDp)
      Size.MEDIUM -> renderMedium(context, snap, heroKey, widgetId, minWidthDp)
      Size.SMALL -> renderSmall(context, snap, heroKey, widgetId, minWidthDp)
    }
  }

  private fun pickSize(w: Int, h: Int): Size =
    when {
      h >= 200 && w >= 200 -> Size.LARGE
      w >= 200 -> Size.MEDIUM
      else -> Size.SMALL
    }

  // Everything a small/medium hero block needs for one metric key. "summary" falls
  // back to form when the snapshot carries no summary block (older snapshot or the
  // card is disabled in the app).
  private data class HeroSpec(
    val label: String,
    val value: String,
    val valueColor: Int,
    val zoneLabel: String?,
    val trendDir: String,
    val delta: String,
  )

  private fun heroSpec(context: Context, snap: WidgetSnapshot?, key: String): HeroSpec {
    val zoneColor = zoneColor(context, snap?.form?.zone)
    return when (key) {
      "fitness" ->
        HeroSpec(
          label(snap, "fitness"), value(snap?.fitness), res(context, R.color.widget_blue),
          null, snap?.fitness?.trendDir ?: "flat", delta(snap?.fitness))
      "fatigue" ->
        HeroSpec(
          label(snap, "fatigue"), value(snap?.fatigue), res(context, R.color.widget_fatigue),
          null, snap?.fatigue?.trendDir ?: "flat", delta(snap?.fatigue))
      "hrv" ->
        HeroSpec(
          label(snap, "hrv"), value(snap?.hrv), res(context, R.color.widget_text_primary),
          null, snap?.hrv?.trendDir ?: "flat", delta(snap?.hrv))
      "rhr" ->
        HeroSpec(
          label(snap, "rhr"), value(snap?.rhr), res(context, R.color.widget_text_primary),
          null, snap?.rhr?.trendDir ?: "flat", delta(snap?.rhr))
      "summary" -> {
        val hero = snap?.summaryCard?.hero
        if (hero == null) {
          heroSpec(context, snap, "form")
        } else {
          HeroSpec(
            hero.label, hero.value, summaryColor(context, hero.colorKey, snap.form.zone),
            null, hero.trendDir, "")
        }
      }
      else ->
        HeroSpec(
          label(snap, "form"), value(snap?.form),
          if (snap?.form?.zone != null) zoneColor else res(context, R.color.widget_text_primary),
          snap?.formZoneLabel, snap?.form?.trendDir ?: "flat", delta(snap?.form))
    }
  }

  private fun renderSmall(
    context: Context,
    snap: WidgetSnapshot?,
    heroKey: String,
    widgetId: Int,
    minWidthDp: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_small)
    val spec = heroSpec(context, snap, heroKey)

    v.setTextViewText(R.id.small_label, spec.label)
    v.setTextViewText(R.id.small_value, spec.value)
    v.setTextColor(R.id.small_value, spec.valueColor)
    bindZoneLabel(v, R.id.small_zone, spec.zoneLabel, spec.valueColor)
    v.setTextViewText(R.id.small_trend, trendArrow(spec.trendDir))
    v.setTextColor(R.id.small_trend, trendColor(context, spec.trendDir))
    v.setTextViewText(R.id.small_delta, spec.delta)
    bindTrendChart(context, v, R.id.small_sparkline, snap, heroKey, chartWidthDp(minWidthDp, 140), 40)
    v.setViewVisibility(R.id.small_pr, if (snap?.latest?.isPr == true) View.VISIBLE else View.GONE)
    bindCycleTap(context, v, R.id.small_hero, widgetId)
    return v
  }

  private fun renderMedium(
    context: Context,
    snap: WidgetSnapshot?,
    heroKey: String,
    widgetId: Int,
    minWidthDp: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_medium)
    val spec = heroSpec(context, snap, heroKey)
    val card = snap?.summaryCard
    val summaryMode = heroKey == "summary" && card != null

    v.setTextViewText(R.id.med_form_label, spec.label)
    v.setTextViewText(R.id.med_form_value, spec.value)
    v.setTextColor(R.id.med_form_value, spec.valueColor)
    v.setTextViewText(R.id.med_form_trend, trendArrow(spec.trendDir))
    v.setTextColor(R.id.med_form_trend, trendColor(context, spec.trendDir))
    bindZoneLabel(v, R.id.med_zone, spec.zoneLabel, spec.valueColor)

    if (summaryMode) {
      bindEntryRow(context, v, snap, MED_ROW_IDS[0], card!!.entries.getOrNull(0))
      bindEntryRow(context, v, snap, MED_ROW_IDS[1], card.entries.getOrNull(1))
      bindEntryRow(context, v, snap, MED_ROW_IDS[2], card.entries.getOrNull(2))
      bindEntryRow(context, v, snap, MED_ROW_IDS[3], card.entries.getOrNull(3))
      v.setViewVisibility(R.id.med_activity_name, View.GONE)
      v.setViewVisibility(R.id.med_pr, View.GONE)
      v.setViewVisibility(R.id.med_activity_sub, View.GONE)
      v.setViewVisibility(R.id.med_impact_row, View.GONE)
      v.setViewVisibility(R.id.med_impact, View.GONE)
    } else {
      // Fixed fitness/fatigue rows; the one duplicating the hero is hidden.
      bindMetricRow(
        context, v, MED_ROW_IDS[0], label(snap, "fitness"), snap?.fitness,
        res(context, R.color.widget_blue), visible = heroKey != "fitness")
      bindMetricRow(
        context, v, MED_ROW_IDS[1], label(snap, "fatigue"), snap?.fatigue,
        res(context, R.color.widget_fatigue), visible = heroKey != "fatigue")
      v.setViewVisibility(R.id.med_entry2_row, View.GONE)
      v.setViewVisibility(R.id.med_entry3_row, View.GONE)
      bindLatest(context, v, snap, R.id.med_activity_name, R.id.med_pr, R.id.med_activity_sub)
      bindImpact(
        context, v, snap, R.id.med_impact_row, R.id.med_impact_before, R.id.med_impact_after,
        R.id.med_impact_tss, R.id.med_impact)
    }

    val chartW = (chartWidthDp(minWidthDp, 300) - 8) / 2
    bindTrendChart(context, v, R.id.med_sparkline, snap, heroKey, chartW.coerceAtLeast(120), 48)
    bindCycleTap(context, v, R.id.med_hero, widgetId)
    return v
  }

  private class RowIds(val row: Int, val label: Int, val value: Int, val trend: Int)

  private val MED_ROW_IDS =
    arrayOf(
      RowIds(R.id.med_fitness_row, R.id.med_fitness_label, R.id.med_fitness_value, R.id.med_fitness_trend),
      RowIds(R.id.med_fatigue_row, R.id.med_fatigue_label, R.id.med_fatigue_value, R.id.med_fatigue_trend),
      RowIds(R.id.med_entry2_row, R.id.med_entry2_label, R.id.med_entry2_value, R.id.med_entry2_trend),
      RowIds(R.id.med_entry3_row, R.id.med_entry3_label, R.id.med_entry3_value, R.id.med_entry3_trend),
    )

  private fun bindMetricRow(
    context: Context,
    v: RemoteViews,
    ids: RowIds,
    text: String,
    m: Metric?,
    valueColor: Int,
    visible: Boolean,
  ) {
    if (!visible) {
      v.setViewVisibility(ids.row, View.GONE)
      return
    }
    v.setViewVisibility(ids.row, View.VISIBLE)
    v.setTextViewText(ids.label, text)
    v.setTextViewText(ids.value, value(m))
    v.setTextColor(ids.value, valueColor)
    v.setTextViewText(ids.trend, m?.let { trendArrow(it.trendDir) } ?: "")
    v.setTextColor(ids.trend, trendColor(context, m?.trendDir ?: "flat"))
  }

  private fun bindEntryRow(
    context: Context,
    v: RemoteViews,
    snap: WidgetSnapshot?,
    ids: RowIds,
    entry: SummaryEntry?,
  ) {
    if (entry == null) {
      v.setViewVisibility(ids.row, View.GONE)
      return
    }
    v.setViewVisibility(ids.row, View.VISIBLE)
    v.setTextViewText(ids.label, entry.label)
    v.setTextViewText(ids.value, entry.value)
    v.setTextColor(ids.value, summaryColor(context, entry.colorKey, snap?.form?.zone))
    v.setTextViewText(ids.trend, trendArrow(entry.trendDir))
    v.setTextColor(ids.trend, trendColor(context, entry.trendDir))
  }

  private fun renderLarge(context: Context, snap: WidgetSnapshot?, minWidthDp: Int): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_large)
    val zoneColor = zoneColor(context, snap?.form?.zone)

    v.setTextViewText(R.id.large_form_label, label(snap, "form"))
    v.setTextViewText(R.id.large_form_value, value(snap?.form))
    v.setTextColor(R.id.large_form_value, zoneColor)
    bindTrend(context, v, R.id.large_form_trend, snap?.form)

    v.setTextViewText(R.id.large_fitness_label, label(snap, "fitness"))
    v.setTextViewText(R.id.large_fitness_value, value(snap?.fitness))
    v.setTextColor(R.id.large_fitness_value, res(context, R.color.widget_blue))
    bindTrend(context, v, R.id.large_fitness_trend, snap?.fitness)

    v.setTextViewText(R.id.large_fatigue_label, label(snap, "fatigue"))
    v.setTextViewText(R.id.large_fatigue_value, value(snap?.fatigue))
    v.setTextColor(R.id.large_fatigue_value, res(context, R.color.widget_fatigue))
    bindTrend(context, v, R.id.large_fatigue_trend, snap?.fatigue)

    val ramp = snap?.rampRate
    if (ramp == null) {
      v.setViewVisibility(R.id.large_ramp, View.GONE)
    } else {
      v.setViewVisibility(R.id.large_ramp, View.VISIBLE)
      val rounded = (ramp * 10).roundToInt() / 10.0
      v.setTextViewText(R.id.large_ramp, "${label(snap, "ramp")} ${if (rounded >= 0) "+" else ""}$rounded/wk")
    }

    bindTrendChart(context, v, R.id.large_sparkline, snap, "form", chartWidthDp(minWidthDp, 300), 60)

    v.setTextViewText(R.id.large_weekly, weeklyLine(snap))
    val deltaPct = snap?.weekly?.deltaPct
    if (deltaPct == null) {
      v.setViewVisibility(R.id.large_weekly_delta, View.GONE)
    } else {
      v.setViewVisibility(R.id.large_weekly_delta, View.VISIBLE)
      v.setTextViewText(R.id.large_weekly_delta, "${if (deltaPct >= 0) "+" else ""}$deltaPct%")
      val deltaRes = if (deltaPct >= 0) R.color.widget_trend_up else R.color.widget_trend_down
      v.setTextColor(R.id.large_weekly_delta, res(context, deltaRes))
    }

    bindLatest(context, v, snap, R.id.large_activity_name, R.id.large_pr, R.id.large_activity_sub)
    bindImpact(
      context, v, snap, R.id.large_impact_row, R.id.large_impact_before, R.id.large_impact_after,
      R.id.large_impact_tss, R.id.large_impact)

    v.setTextViewText(R.id.large_hrv_label, label(snap, "hrv"))
    v.setTextViewText(R.id.large_hrv_value, value(snap?.hrv))
    bindTrend(context, v, R.id.large_hrv_trend, snap?.hrv)
    v.setTextViewText(R.id.large_rhr_label, label(snap, "rhr"))
    v.setTextViewText(R.id.large_rhr_value, value(snap?.rhr))
    bindTrend(context, v, R.id.large_rhr_trend, snap?.rhr)

    v.setOnClickPendingIntent(R.id.large_record, recordIntent(context))
    return v
  }

  // ---- latest activity widget ---------------------------------------------------

  fun renderActivity(context: Context, snap: WidgetSnapshot?, minWidthDp: Int): RemoteViews {
    val layout = if (minWidthDp >= 200) R.layout.widget_activity_medium else R.layout.widget_activity_small
    val v = RemoteViews(context.packageName, layout)
    val latest = snap?.latest

    if (latest == null) {
      // No snapshot yet: text card nudging into the app (same wording as iOS).
      v.setTextViewText(R.id.act_name, "Open Veloq")
      v.setTextColor(R.id.act_name, res(context, R.color.widget_text_primary))
      v.setTextViewText(R.id.act_sub, "to see your training")
      v.setViewVisibility(R.id.act_preview, View.GONE)
      v.setViewVisibility(R.id.act_pr, View.GONE)
      v.setViewVisibility(R.id.act_tss, View.GONE)
      v.setOnClickPendingIntent(R.id.act_root, deepLink(context, "veloq://", 3))
      return v
    }

    val tint = tintOrDefault(context, latest.tintHex)
    v.setTextViewText(R.id.act_name, latest.name)
    v.setTextColor(R.id.act_name, tint)
    v.setTextViewText(
      R.id.act_sub,
      joinDot(latest.distanceLabel, latest.durationLabel, latest.dateLabel))
    v.setViewVisibility(R.id.act_pr, if (latest.isPr) View.VISIBLE else View.GONE)

    val tss = latest.trainingLoad
    if (tss == null) {
      v.setViewVisibility(R.id.act_tss, View.GONE)
    } else {
      v.setViewVisibility(R.id.act_tss, View.VISIBLE)
      v.setTextViewText(R.id.act_tss, "$tss TSS")
    }

    val preview = latest.routePreview
    if (preview == null) {
      v.setViewVisibility(R.id.act_preview, View.GONE)
    } else {
      val d = context.resources.displayMetrics.density
      val bmp = RoutePreviewBitmap.render(preview, (140 * d).roundToInt(), (100 * d).roundToInt(), tint)
      v.setImageViewBitmap(R.id.act_preview, bmp)
      v.setViewVisibility(R.id.act_preview, View.VISIBLE)
    }

    val url = latest.activityId?.let { "veloq://activity/$it" } ?: "veloq://"
    v.setOnClickPendingIntent(R.id.act_root, deepLink(context, url, 3))
    return v
  }

  // ---- intents ------------------------------------------------------------------

  fun recordIntent(context: Context): PendingIntent = deepLink(context, "veloq://record", 0)

  private fun deepLink(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent =
      Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        `package` = context.packageName
      }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE)
  }

  private fun bindCycleTap(context: Context, v: RemoteViews, id: Int, widgetId: Int) {
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
    val intent =
      Intent(context, VeloqWidgetProvider::class.java).apply {
        action = VeloqWidgetProvider.ACTION_CYCLE_METRIC
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      }
    val pi =
      PendingIntent.getBroadcast(
        context, widgetId, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    v.setOnClickPendingIntent(id, pi)
  }

  // ---- shared binding helpers -------------------------------------------------

  private fun bindTrend(context: Context, v: RemoteViews, id: Int, m: Metric?) {
    v.setTextViewText(id, m?.let { trendArrow(it.trendDir) } ?: "")
    v.setTextColor(id, trendColor(context, m?.trendDir ?: "flat"))
  }

  private fun bindZoneLabel(v: RemoteViews, id: Int, zoneLabel: String?, color: Int) {
    if (zoneLabel.isNullOrEmpty()) {
      v.setViewVisibility(id, View.GONE)
    } else {
      v.setViewVisibility(id, View.VISIBLE)
      v.setTextViewText(id, zoneLabel)
      v.setTextColor(id, color)
    }
  }

  // Launchers can report 0 before the first options callback; fall back per size.
  private fun chartWidthDp(minWidthDp: Int, fallbackDp: Int): Int =
    (if (minWidthDp > 0) minWidthDp else fallbackDp) - 32

  private fun chartColors(context: Context) =
    FitnessChart.ChartColors(
      fitness = res(context, R.color.widget_chart_fitness),
      fatigue = res(context, R.color.widget_chart_fatigue),
      casing = res(context, R.color.widget_chart_casing),
      axisText = res(context, R.color.widget_text_muted),
      grid = res(context, R.color.widget_border),
      divider = res(context, R.color.widget_surface),
    )

  // Which chart a hero key shows: the TSB heroes and the summary "fitnessForm" mode
  // all render the feed-style fitness+fatigue+form-bar chart; HRV renders its own
  // single series. No tap action - the chart is display-only.
  private fun bindTrendChart(
    context: Context,
    v: RemoteViews,
    id: Int,
    snap: WidgetSnapshot?,
    heroKey: String,
    widthDp: Int,
    heightDp: Int,
  ) {
    val kind =
      if (heroKey == "summary") snap?.summaryCard?.sparkline ?: "fitnessForm"
      else
        when (heroKey) {
          "form", "fitness", "fatigue" -> "fitnessForm"
          "hrv" -> "hrv"
          else -> "none"
        }

    val d = context.resources.displayMetrics.density
    val w = (widthDp * d).roundToInt()
    val h = (heightDp * d).roundToInt()

    val bmp =
      when {
        kind == "fitnessForm" && (snap?.fitnessSparkline?.size ?: 0) >= 2 ->
          FitnessChart.fitnessBitmap(
            snap!!.fitnessSparkline,
            snap.fatigueSparkline,
            snap.formZones.map { zoneColor(context, it) },
            w, h, d, chartColors(context))
        kind == "hrv" && (snap?.hrvSparkline?.size ?: 0) >= 2 ->
          FitnessChart.singleBitmap(
            snap!!.hrvSparkline, res(context, R.color.widget_primary), w, h, d, chartColors(context))
        else -> null
      }

    if (bmp == null) {
      v.setViewVisibility(id, View.GONE)
    } else {
      v.setImageViewBitmap(id, bmp)
      v.setViewVisibility(id, View.VISIBLE)
    }
  }

  private fun bindLatest(
    context: Context,
    v: RemoteViews,
    snap: WidgetSnapshot?,
    nameId: Int,
    prId: Int,
    subId: Int,
  ) {
    val latest = snap?.latest
    if (latest == null) {
      v.setViewVisibility(nameId, View.GONE)
      v.setViewVisibility(prId, View.GONE)
      v.setViewVisibility(subId, View.GONE)
      return
    }
    v.setViewVisibility(nameId, View.VISIBLE)
    v.setViewVisibility(subId, View.VISIBLE)
    v.setTextViewText(nameId, latest.name)
    v.setTextColor(nameId, tintOrDefault(context, latest.tintHex))
    v.setTextViewText(subId, joinDot(latest.distanceLabel, latest.durationLabel, latest.dateLabel))
    v.setViewVisibility(prId, if (latest.isPr) View.VISIBLE else View.GONE)
  }

  // Structured before-after impact, each value tinted by its own zone; falls back to
  // the flat pre-composed line when the structured fields are absent (older snapshot).
  private fun bindImpact(
    context: Context,
    v: RemoteViews,
    snap: WidgetSnapshot?,
    rowId: Int,
    beforeId: Int,
    afterId: Int,
    tssId: Int,
    flatId: Int,
  ) {
    val impact = snap?.impact
    if (impact != null) {
      v.setViewVisibility(rowId, View.VISIBLE)
      v.setViewVisibility(flatId, View.GONE)
      v.setTextViewText(beforeId, impact.formBefore.roundToInt().toString())
      v.setTextColor(beforeId, zoneColor(context, impact.beforeZone))
      v.setTextViewText(afterId, impact.formAfter.roundToInt().toString())
      v.setTextColor(afterId, zoneColor(context, impact.afterZone))
      val tss = impact.tssAdded
      if (tss == null) {
        v.setViewVisibility(tssId, View.GONE)
      } else {
        v.setViewVisibility(tssId, View.VISIBLE)
        v.setTextViewText(tssId, "${if (tss >= 0) "+" else ""}$tss TSS")
      }
      return
    }
    v.setViewVisibility(rowId, View.GONE)
    val flat = snap?.impactLine
    if (flat.isNullOrEmpty()) {
      v.setViewVisibility(flatId, View.GONE)
    } else {
      v.setViewVisibility(flatId, View.VISIBLE)
      v.setTextViewText(flatId, flat)
    }
  }

  // ---- formatting -------------------------------------------------------------

  private fun label(snap: WidgetSnapshot?, key: String): String =
    snap?.metricLabels?.get(key) ?: key.replaceFirstChar { it.uppercase() }

  private fun value(m: Metric?): String = m?.let { it.value.roundToInt().toString() } ?: "-"

  private fun delta(m: Metric?): String {
    val d = m?.delta ?: return ""
    val r = d.roundToInt()
    return "${if (r >= 0) "+" else ""}$r"
  }

  private fun weeklyLine(snap: WidgetSnapshot?): String {
    val w = snap?.weekly ?: return ""
    val parts = mutableListOf("${snap.weekLabel} ${w.count}")
    if (w.durationLabel.isNotEmpty()) parts.add(w.durationLabel)
    if (w.distanceLabel.isNotEmpty()) parts.add(w.distanceLabel)
    parts.add("${w.tss} TSS")
    return parts.joinToString(" · ")
  }

  private fun joinDot(vararg parts: String): String =
    parts.filter { it.isNotEmpty() }.joinToString(" · ")

  private fun trendArrow(dir: String): String =
    when (dir) {
      "up" -> "▲"
      "down" -> "▼"
      else -> "–"
    }

  private fun trendColor(context: Context, dir: String): Int {
    val colorRes =
      when (dir) {
        "up" -> R.color.widget_trend_up
        "down" -> R.color.widget_trend_down
        else -> R.color.widget_trend_flat
      }
    return res(context, colorRes)
  }

  private fun zoneColor(context: Context, zone: String?): Int {
    val colorRes =
      when (zone) {
        "highRisk" -> R.color.widget_form_high_risk
        "optimal" -> R.color.widget_form_optimal
        "greyZone" -> R.color.widget_form_grey_zone
        "fresh" -> R.color.widget_form_fresh
        "transition" -> R.color.widget_form_transition
        else -> R.color.widget_text_primary
      }
    return res(context, colorRes)
  }

  private fun summaryColor(context: Context, colorKey: String, formZone: String?): Int =
    when (colorKey) {
      "blue" -> res(context, R.color.widget_blue)
      "fatigue" -> res(context, R.color.widget_fatigue)
      "formZone" -> zoneColor(context, formZone)
      else -> res(context, R.color.widget_text_primary)
    }

  private fun res(context: Context, id: Int): Int = ContextCompat.getColor(context, id)

  private fun tintOrDefault(context: Context, hex: String): Int =
    try {
      Color.parseColor(hex)
    } catch (_: Exception) {
      res(context, R.color.widget_text_primary)
    }
}
