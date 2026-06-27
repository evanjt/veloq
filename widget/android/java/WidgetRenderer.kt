package __PKG__.widget

import android.content.Context
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import __PKG__.R
import kotlin.math.roundToInt

/**
 * Builds the RemoteViews for a widget instance from the snapshot. Picks a layout by the
 * host-reported cell size and binds pre-formatted strings — no computation, no i18n.
 * Dynamic colours come from the generated `widget_*` resources (auto light/dark) plus
 * the snapshot's resolved activity tint.
 */
object WidgetRenderer {
  private enum class Size {
    SMALL,
    MEDIUM,
    LARGE,
  }

  fun render(context: Context, snap: WidgetSnapshot?, minWidthDp: Int, minHeightDp: Int): RemoteViews {
    return when (pickSize(minWidthDp, minHeightDp)) {
      Size.LARGE -> renderLarge(context, snap)
      Size.MEDIUM -> renderMedium(context, snap)
      Size.SMALL -> renderSmall(context, snap)
    }
  }

  private fun pickSize(w: Int, h: Int): Size =
    when {
      h >= 200 && w >= 200 -> Size.LARGE
      w >= 200 -> Size.MEDIUM
      else -> Size.SMALL
    }

  private fun renderSmall(context: Context, snap: WidgetSnapshot?): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_small)
    v.setTextViewText(R.id.small_label, label(snap, "form"))
    v.setTextViewText(R.id.small_value, value(snap?.form))
    bindTrend(context, v, R.id.small_trend, snap?.form)
    return v
  }

  private fun renderMedium(context: Context, snap: WidgetSnapshot?): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_medium)
    v.setTextViewText(R.id.med_form_label, label(snap, "form"))
    v.setTextViewText(R.id.med_form_value, value(snap?.form))
    bindTrend(context, v, R.id.med_form_trend, snap?.form)
    v.setTextViewText(R.id.med_fitness, metricLine(snap, "fitness", snap?.fitness))
    bindLatest(context, v, snap, R.id.med_activity_name, R.id.med_activity_sub, R.id.med_impact)
    return v
  }

  private fun renderLarge(context: Context, snap: WidgetSnapshot?): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_large)
    v.setTextViewText(R.id.large_fitness_label, label(snap, "fitness"))
    v.setTextViewText(R.id.large_fitness_value, value(snap?.fitness))
    v.setTextViewText(R.id.large_fatigue_label, label(snap, "fatigue"))
    v.setTextViewText(R.id.large_fatigue_value, value(snap?.fatigue))
    v.setTextViewText(R.id.large_form_label, label(snap, "form"))
    v.setTextViewText(R.id.large_form_value, value(snap?.form))
    bindTrend(context, v, R.id.large_form_trend, snap?.form)

    val spark = snap?.fitnessSparkline ?: emptyList()
    if (spark.size >= 2) {
      val d = context.resources.displayMetrics.density
      val bmp =
        Sparkline.bitmap(
          spark,
          (260 * d).roundToInt(),
          (40 * d).roundToInt(),
          ContextCompat.getColor(context, R.color.widget_blue),
        )
      v.setImageViewBitmap(R.id.large_sparkline, bmp)
      v.setViewVisibility(R.id.large_sparkline, View.VISIBLE)
    } else {
      v.setViewVisibility(R.id.large_sparkline, View.GONE)
    }

    v.setTextViewText(R.id.large_weekly, weeklyLine(snap))
    bindLatest(context, v, snap, R.id.large_activity_name, R.id.large_activity_sub, R.id.large_impact)
    return v
  }

  // ---- shared binding helpers -------------------------------------------------

  private fun bindTrend(context: Context, v: RemoteViews, id: Int, m: Metric?) {
    v.setTextViewText(id, m?.let { trendArrow(it.trendDir) } ?: "")
    v.setTextColor(id, trendColor(context, m?.trendDir ?: "flat"))
  }

  private fun bindLatest(
    context: Context,
    v: RemoteViews,
    snap: WidgetSnapshot?,
    nameId: Int,
    subId: Int,
    impactId: Int,
  ) {
    val latest = snap?.latest
    if (latest == null) {
      v.setViewVisibility(nameId, View.GONE)
      v.setViewVisibility(subId, View.GONE)
    } else {
      v.setViewVisibility(nameId, View.VISIBLE)
      v.setViewVisibility(subId, View.VISIBLE)
      v.setTextViewText(nameId, latest.name)
      v.setTextColor(nameId, tintOrDefault(context, latest.tintHex))
      v.setTextViewText(subId, joinDot(latest.distanceLabel, latest.durationLabel, latest.dateLabel))
    }

    val impact = snap?.impactLine
    if (impact.isNullOrEmpty()) {
      v.setViewVisibility(impactId, View.GONE)
    } else {
      v.setViewVisibility(impactId, View.VISIBLE)
      v.setTextViewText(impactId, impact)
    }
  }

  // ---- formatting -------------------------------------------------------------

  private fun label(snap: WidgetSnapshot?, key: String): String =
    snap?.metricLabels?.get(key) ?: key.replaceFirstChar { it.uppercase() }

  private fun value(m: Metric?): String = m?.let { it.value.roundToInt().toString() } ?: "—"

  private fun metricLine(snap: WidgetSnapshot?, key: String, m: Metric?): String {
    if (m == null) return ""
    return "${label(snap, key)} ${m.value.roundToInt()} ${trendArrow(m.trendDir)}"
  }

  private fun weeklyLine(snap: WidgetSnapshot?): String {
    val w = snap?.weekly ?: return ""
    val head = "${snap.weekLabel}  ${w.tss} TSS"
    val parts = mutableListOf(head)
    if (w.distanceLabel.isNotEmpty()) parts.add(w.distanceLabel)
    w.deltaPct?.let { parts.add("${if (it >= 0) "+" else ""}$it%") }
    return parts.joinToString(" · ")
  }

  private fun joinDot(vararg parts: String): String =
    parts.filter { it.isNotEmpty() }.joinToString(" · ")

  private fun trendArrow(dir: String): String =
    when (dir) {
      "up" -> "▲"
      "down" -> "▼"
      else -> "—"
    }

  private fun trendColor(context: Context, dir: String): Int {
    val res =
      when (dir) {
        "up" -> R.color.widget_trend_up
        "down" -> R.color.widget_trend_down
        else -> R.color.widget_trend_flat
      }
    return ContextCompat.getColor(context, res)
  }

  private fun tintOrDefault(context: Context, hex: String): Int =
    try {
      Color.parseColor(hex)
    } catch (_: Exception) {
      ContextCompat.getColor(context, R.color.widget_text_primary)
    }
}
