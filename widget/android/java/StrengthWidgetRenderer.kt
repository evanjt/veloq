package __PKG__.widget

import android.content.Context
import android.view.View
import android.widget.RemoteViews
import __PKG__.R
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Builds the RemoteViews for a Strength widget instance. [StrengthWidget] decides what a size
 * draws; this places it: the window's name, each side of the body as a bitmap, the most trained
 * muscles on the largest size, and the age line. The whole widget opens the strength tab.
 *
 * The window names, muscle names and figures are the engine's words, carried by the snapshot, so
 * nothing here is worded or translated except the lines that exist before any snapshot does.
 */
object StrengthWidgetRenderer {
  private class RowIds(val row: Int, val name: Int, val detail: Int)

  private val ROWS =
    arrayOf(
      RowIds(R.id.str_row0, R.id.str_name0, R.id.str_detail0),
      RowIds(R.id.str_row1, R.id.str_name1, R.id.str_detail1),
      RowIds(R.id.str_row2, R.id.str_name2, R.id.str_detail2),
      RowIds(R.id.str_row3, R.id.str_name3, R.id.str_detail3),
    )

  private val RAMP =
    intArrayOf(
      R.color.widget_strength_ramp_1,
      R.color.widget_strength_ramp_2,
      R.color.widget_strength_ramp_3,
      R.color.widget_strength_ramp_4,
      R.color.widget_strength_ramp_5,
    )

  private const val PADDING_DP = 16
  private const val GAP_DP = 8

  // Two sides at the largest placement stay well inside what a host accepts for one update.
  private const val MAX_BODY_PX = 640

  fun render(
    context: Context,
    snap: WidgetSnapshot?,
    minWidthDp: Int,
    minHeightDp: Int,
    window: String?,
  ): RemoteViews {
    val p = WidgetPalette(context)
    val size = StrengthWidget.sizeFor(minWidthDp, minHeightDp)
    val narrow = size == SummarySize.SHORT || size == SummarySize.SMALL
    val v =
      RemoteViews(
        context.packageName, if (narrow) R.layout.widget_strength_small else R.layout.widget_strength)
    val content = StrengthWidget.content(snap, size, window)

    if (content == null) {
      v.setOnClickPendingIntent(R.id.str_root, WidgetRenderer.deepLink(context, "veloq://", 30))
      v.setViewVisibility(R.id.str_label, View.GONE)
      showBody(v, narrow, false)
      bindMessage(
        v, context.getString(R.string.widget_open_app), context.getString(R.string.widget_to_see_training))
      if (!narrow) bindRows(v, emptyList())
      v.setViewVisibility(R.id.str_age, View.VISIBLE)
      WidgetRenderer.bindUpdatedAt(p, v, R.id.str_updated, null)
      WidgetRenderer.bindRefresh(context, v, null)
      return v
    }

    v.setOnClickPendingIntent(R.id.str_root, WidgetRenderer.deepLink(context, content.url, 30))
    v.setViewVisibility(R.id.str_label, if (content.label.isEmpty()) View.GONE else View.VISIBLE)
    v.setTextViewText(R.id.str_label, content.label)

    val empty = content.emptyText
    if (empty != null) {
      showBody(v, narrow, false)
      bindMessage(v, empty, null)
    } else {
      showBody(v, narrow, true)
      bindBody(context, p, v, content, narrow, minWidthDp)
    }
    if (!narrow) bindRows(v, content.top)

    // A host reapplies these views over the ones it shows, which a short placement left hidden.
    v.setViewVisibility(R.id.str_age, if (size == SummarySize.SHORT) View.GONE else View.VISIBLE)
    WidgetRenderer.bindUpdatedAt(p, v, R.id.str_updated, snap)
    WidgetRenderer.bindRefresh(context, v, snap)
    return v
  }

  /** The body and the message share one place; only one of them shows. */
  private fun showBody(v: RemoteViews, narrow: Boolean, body: Boolean) {
    v.setViewVisibility(R.id.str_message, if (body) View.GONE else View.VISIBLE)
    if (narrow) {
      v.setViewVisibility(R.id.str_front, if (body) View.VISIBLE else View.GONE)
    } else {
      v.setViewVisibility(R.id.str_bodies, if (body) View.VISIBLE else View.GONE)
    }
  }

  /** The centred words shown in place of the body, with an optional second line. */
  private fun bindMessage(v: RemoteViews, text: String, hint: String?) {
    v.setTextViewText(R.id.str_empty, text)
    if (hint == null) {
      v.setViewVisibility(R.id.str_empty_hint, View.GONE)
    } else {
      v.setViewVisibility(R.id.str_empty_hint, View.VISIBLE)
      v.setTextViewText(R.id.str_empty_hint, hint)
    }
  }

  /**
   * Each side the size draws, as wide as the room the placement leaves it. A launcher reports the
   * landscape height, which understates the portrait one, so the box is sized from the width and
   * the ImageView fits it to the height it is given. A host that has not reported a size yet gives
   * 0, so the provider info's own minimum stands in.
   */
  private fun bindBody(
    context: Context,
    p: WidgetPalette,
    v: RemoteViews,
    content: StrengthContent,
    narrow: Boolean,
    minWidthDp: Int,
  ) {
    val widthDp = if (minWidthDp > 0) minWidthDp else 110
    val slotDp =
      if (narrow) widthDp - 2 * PADDING_DP
      else (widthDp - 2 * PADDING_DP - GAP_DP) / 2 / content.sides.size.coerceAtLeast(1)
    val d = context.resources.displayMetrics.density
    val heightPx = min(MAX_BODY_PX.toFloat(), 2 * slotDp.coerceAtLeast(16) * d).roundToInt()

    val fill = p.color(R.color.widget_body_fill)
    val ramp = RAMP.map { p.color(it) }
    for (side in content.sides) {
      val id = if (side == BodyOutline.Side.FRONT) R.id.str_front else R.id.str_back
      p.bitmap(v, id) { dark ->
        BodyBitmap.render(
          content, side, heightPx, fill.pick(dark), IntArray(ramp.size) { ramp[it].pick(dark) })
      }
    }
    // The front is always drawn, so it says what both sides show and the back says nothing.
    v.setContentDescription(R.id.str_front, content.bodyLabel)
    if (!narrow) {
      v.setViewVisibility(
        R.id.str_back, if (BodyOutline.Side.BACK in content.sides) View.VISIBLE else View.GONE)
    }
  }

  /** One row per top muscle and nothing for the rest: the name, then the sets and the volume. */
  private fun bindRows(v: RemoteViews, top: List<StrengthTopMuscle>) {
    for ((i, ids) in ROWS.withIndex()) {
      val muscle = top.getOrNull(i)
      v.setViewVisibility(ids.row, if (muscle == null) View.GONE else View.VISIBLE)
      if (muscle == null) continue
      v.setTextViewText(ids.name, muscle.name)
      v.setTextViewText(
        ids.detail, listOfNotNull(muscle.setsText.ifEmpty { null }, muscle.volumeText).joinToString(" · "))
    }
  }
}
