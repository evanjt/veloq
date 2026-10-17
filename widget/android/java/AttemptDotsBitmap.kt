package __PKG__.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import kotlin.math.max
import kotlin.math.min

/**
 * Draws the attempts at a route as a row of dots for RemoteViews, oldest first, each as
 * [AttemptMark] decides: an earlier attempt is a small dot, the record a gold one, and this
 * activity the reticle, four short ticks in primary text round its dot, drawn at the row's height.
 * No mark takes the sport's colour.
 */
object AttemptDotsBitmap {
  class Colors(val earlier: Int, val record: Int, val reticle: Int)

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
    // Inside the reticle the dot gives the ticks the outer part of the cell.
    val ringed = full * 0.4f
    val step = full * (1 + gapRatio)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    val ticks = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = full * 0.12f
      strokeCap = Paint.Cap.ROUND
      color = colors.reticle
    }
    val outer = full / 2 - ticks.strokeWidth / 2
    val inner = full * 0.32f
    val canvas = Canvas(bmp)
    dots.forEachIndexed { i, dot ->
      val mark = AttemptMark.of(dot)
      val cx = full / 2 + i * step
      val cy = h / 2f
      fill.color = if (mark.fill == AttemptFill.RECORD) colors.record else colors.earlier
      val diameter =
        when {
          mark.reticle -> ringed
          mark.full -> full
          else -> small
        }
      canvas.drawCircle(cx, cy, diameter / 2, fill)
      if (mark.reticle) {
        canvas.drawLine(cx, cy - outer, cx, cy - inner, ticks)
        canvas.drawLine(cx, cy + inner, cx, cy + outer, ticks)
        canvas.drawLine(cx - outer, cy, cx - inner, cy, ticks)
        canvas.drawLine(cx + inner, cy, cx + outer, cy, ticks)
      }
    }
    return bmp
  }
}
