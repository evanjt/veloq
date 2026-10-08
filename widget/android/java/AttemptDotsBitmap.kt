package __PKG__.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import kotlin.math.max
import kotlin.math.min

/**
 * Draws the attempts at a route as a row of dots for RemoteViews, oldest first. An earlier attempt
 * is a small dot, the record a gold one and the latest the full height in the activity's colour;
 * the latest keeps a ring in its own colour when it is also the record.
 */
object AttemptDotsBitmap {
  class Colors(val earlier: Int, val record: Int, val current: Int)

  fun render(dots: List<AttemptDot>, widthPx: Int, heightPx: Int, colors: Colors): Bitmap {
    val w = max(1, widthPx)
    val h = max(1, heightPx)
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    if (dots.isEmpty()) return bmp

    // The full diameter is the height, shrunk until the whole row fits the width.
    val gapRatio = 0.6f
    val fit = w / (dots.size + (dots.size - 1) * gapRatio)
    val full = min(h.toFloat(), fit)
    val small = full * 0.7f
    val step = full * (1 + gapRatio)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = full * 0.18f
      color = colors.current
    }
    val canvas = Canvas(bmp)
    dots.forEachIndexed { i, dot ->
      val diameter = if (dot.current || dot.record) full else small
      val cx = full / 2 + i * step
      val cy = h / 2f
      fill.color =
        when {
          dot.record -> colors.record
          dot.current -> colors.current
          else -> colors.earlier
        }
      canvas.drawCircle(cx, cy, diameter / 2, fill)
      if (dot.current && dot.record) canvas.drawCircle(cx, cy, diameter / 2 - ring.strokeWidth / 2, ring)
    }
    return bmp
  }
}
