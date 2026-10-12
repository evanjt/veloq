package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.widget.RemoteViews

/**
 * Builds a placement's views for every size its launcher may draw it at, read through
 * [ReportedSizes] and drawn once per layout bucket by [WidgetSizes.oneEach]. From API 31 the
 * launcher picks among the sizes itself; below it, a host takes a landscape and a portrait drawing.
 */
object WidgetLayouts {
  fun reported(options: Bundle): ReportedSizes {
    val sizes =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        @Suppress("DEPRECATION")
        options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
          ?.map { WidgetSize(it.width.toInt(), it.height.toInt()) }
          .orEmpty()
      } else {
        emptyList()
      }
    return ReportedSizes(
      minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH),
      minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT),
      maxWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH),
      maxHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT),
      sizes = sizes,
    )
  }

  /** [render] draws one size; [bucket] names the layout a size gets, so equal ones draw once. */
  fun <B> build(
    options: Bundle,
    bucket: (WidgetSize) -> B,
    render: (WidgetSize) -> RemoteViews,
  ): RemoteViews {
    val reported = reported(options)
    val drawn = WidgetSizes.oneEach(reported.all, bucket)
    if (drawn.size == 1) return render(drawn.single().first)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return RemoteViews(
        drawn.associate { (size, _) ->
          SizeF(size.widthDp.toFloat(), size.heightDp.toFloat()) to render(size)
        })
    }
    // Below API 31 the list is always the portrait and landscape pair, here in two buckets.
    return RemoteViews(render(reported.landscape), render(reported.portrait))
  }
}
