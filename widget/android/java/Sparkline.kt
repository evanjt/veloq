package __PKG__.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.max

/**
 * Renders a tiny line sparkline to a Bitmap. RemoteViews can't host custom views, so
 * the chart is drawn off-screen and set via setImageViewBitmap. Values are oldest-first
 * (left→right in time), matching the snapshot's reversed sparkline arrays.
 */
object Sparkline {
  fun bitmap(values: List<Float>, widthPx: Int, heightPx: Int, colorInt: Int): Bitmap {
    val w = max(1, widthPx)
    val h = max(1, heightPx)
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    if (values.size < 2) return bmp

    val canvas = Canvas(bmp)
    val minV = values.min()
    val maxV = values.max()
    val range = (maxV - minV).takeIf { it > 0f } ?: 1f

    val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colorInt
        style = Paint.Style.STROKE
        strokeWidth = h * 0.07f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
      }

    // Inset by the stroke so the rounded caps aren't clipped at the edges.
    val pad = paint.strokeWidth
    val usableW = (w - pad * 2).coerceAtLeast(1f)
    val usableH = (h - pad * 2).coerceAtLeast(1f)
    val lastIndex = values.size - 1

    val path = Path()
    values.forEachIndexed { i, v ->
      val x = pad + usableW * (i.toFloat() / lastIndex)
      val y = pad + usableH * (1f - (v - minV) / range)
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    canvas.drawPath(path, paint)
    return bmp
  }
}
