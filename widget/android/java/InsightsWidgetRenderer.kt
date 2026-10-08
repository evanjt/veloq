package __PKG__.widget

import android.content.Context
import android.view.View
import android.widget.RemoteViews
import __PKG__.R

/**
 * Builds the RemoteViews for an Insights widget instance. [InsightsWidget] decides what a size
 * lists; this places it: a tone mark, the title and the subtitle per row, the count of further
 * rows on the largest size, and the age line. Every row is its own tap target and the rest of
 * the widget opens the Insights tab.
 *
 * Titles and subtitles are the Insights tab's own words, carried by the snapshot, so nothing here
 * is worded or translated except the two lines that exist before any snapshot does.
 */
object InsightsWidgetRenderer {
  private class RowIds(val row: Int, val dot: Int, val title: Int, val subtitle: Int)

  private val ROWS =
    arrayOf(
      RowIds(R.id.ins_row0, R.id.ins_dot0, R.id.ins_title0, R.id.ins_subtitle0),
      RowIds(R.id.ins_row1, R.id.ins_dot1, R.id.ins_title1, R.id.ins_subtitle1),
      RowIds(R.id.ins_row2, R.id.ins_dot2, R.id.ins_title2, R.id.ins_subtitle2),
      RowIds(R.id.ins_row3, R.id.ins_dot3, R.id.ins_title3, R.id.ins_subtitle3),
    )

  fun render(
    context: Context,
    snap: WidgetSnapshot?,
    minWidthDp: Int,
    minHeightDp: Int,
    kinds: Set<String>?,
    widgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, R.layout.widget_insights)
    v.setOnClickPendingIntent(R.id.ins_root, WidgetRenderer.deepLink(context, InsightsWidget.TAB_URL, 20))

    if (WidgetSnapshot.showsEmptyPrompt(snap) || snap == null) {
      bindMessage(
        v, context.getString(R.string.widget_open_app),
        context.getString(R.string.widget_to_see_training))
      bindRows(context, v, emptyList(), 0, SummarySize.SMALL)
      bindMore(context, v, 0)
      WidgetRenderer.bindUpdatedAt(context, v, R.id.ins_updated, null)
      return v
    }

    val size = InsightsWidget.sizeFor(minWidthDp, minHeightDp)
    val content = InsightsWidget.content(snap, size, kinds)
    if (content.rows.isEmpty()) {
      bindMessage(v, context.getString(R.string.widget_insights_empty), null)
    } else {
      v.setViewVisibility(R.id.ins_message, View.GONE)
    }
    bindRows(context, v, content.rows, widgetId, size)
    bindMore(context, v, content.more)
    WidgetRenderer.bindUpdatedAt(context, v, R.id.ins_updated, snap)
    return v
  }

  /** The centred line shown when there is nothing to list, with an optional second line. */
  private fun bindMessage(v: RemoteViews, text: String, hint: String?) {
    v.setViewVisibility(R.id.ins_message, View.VISIBLE)
    v.setTextViewText(R.id.ins_empty, text)
    if (hint == null) {
      v.setViewVisibility(R.id.ins_empty_hint, View.GONE)
    } else {
      v.setViewVisibility(R.id.ins_empty_hint, View.VISIBLE)
      v.setTextViewText(R.id.ins_empty_hint, hint)
    }
  }

  /** One row per insight and nothing for the rest; the line limits give a small placement room to wrap. */
  private fun bindRows(
    context: Context,
    v: RemoteViews,
    rows: List<WidgetInsight>,
    widgetId: Int,
    size: SummarySize,
  ) {
    val titleLines = if (size == SummarySize.SMALL) 3 else 2
    val subtitleLines = if (size == SummarySize.MEDIUM) 1 else 2
    for ((i, ids) in ROWS.withIndex()) {
      val insight = rows.getOrNull(i)
      v.setViewVisibility(ids.row, if (insight == null) View.GONE else View.VISIBLE)
      if (insight == null) continue
      v.setInt(ids.dot, "setColorFilter", toneColor(context, insight.tone))
      v.setTextViewText(ids.title, insight.title)
      v.setInt(ids.title, "setMaxLines", titleLines)
      if (insight.subtitle.isEmpty()) {
        v.setViewVisibility(ids.subtitle, View.GONE)
      } else {
        v.setViewVisibility(ids.subtitle, View.VISIBLE)
        v.setTextViewText(ids.subtitle, insight.subtitle)
        v.setInt(ids.subtitle, "setMaxLines", subtitleLines)
      }
      v.setOnClickPendingIntent(ids.row, WidgetRenderer.deepLink(context, insight.url, 21 + i))
    }
  }

  /** "+3 more", opening the Insights tab, on the largest size when rows were left out. */
  private fun bindMore(context: Context, v: RemoteViews, more: Int) {
    if (more <= 0) {
      v.setViewVisibility(R.id.ins_more, View.GONE)
      return
    }
    v.setViewVisibility(R.id.ins_more, View.VISIBLE)
    v.setTextViewText(
      R.id.ins_more,
      context.getString(R.string.widget_insights_more).replace("{{rest}}", more.toString()))
    v.setOnClickPendingIntent(R.id.ins_more, WidgetRenderer.deepLink(context, InsightsWidget.TAB_URL, 25))
  }

  /** The tab's tone for a row, from the generated palette; an unknown tone reads as neutral. */
  private fun toneColor(context: Context, tone: String): Int =
    WidgetRenderer.res(
      context,
      when (tone) {
        "negative" -> R.color.widget_tone_negative
        "caution" -> R.color.widget_tone_caution
        "positive" -> R.color.widget_tone_positive
        "record" -> R.color.widget_tone_record
        "info" -> R.color.widget_tone_info
        "opportunity" -> R.color.widget_tone_opportunity
        else -> R.color.widget_tone_neutral
      })
}
