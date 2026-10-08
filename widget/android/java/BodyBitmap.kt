package __PKG__.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Draws one side of one body into a Bitmap for RemoteViews: every outline part in the body fill,
 * each trained muscle in its step of the strength ramp. The bitmap is the body's own box, twice as
 * tall as it is wide, so the ImageView that shows it letterboxes it into whatever room the host
 * gives, as it does with a route.
 */
object BodyBitmap {
  /** Height over width of the box the outlines are drawn in. */
  private const val ASPECT = 2f

  fun render(
    content: StrengthContent,
    side: BodyOutline.Side,
    heightPx: Int,
    bodyFill: Int,
    ramp: IntArray,
  ): Bitmap {
    val h = max(2, heightPx)
    val w = max(1, (h / ASPECT).roundToInt())
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val boxW = w.toFloat()
    val boxH = h.toFloat()

    val canvas = Canvas(bmp)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    for (part in BodyOutline.parts(content.female, side)) {
      val shade = content.shadeOf(part.slug)
      paint.color = if (shade > 0) ramp[(shade - 1).coerceAtMost(ramp.size - 1)] else bodyFill
      val path = Path().apply { fillType = Path.FillType.WINDING }
      for (ring in part.polygons) {
        for (i in 0 until ring.size / 2) {
          val x = ring[2 * i] * boxW
          val y = ring[2 * i + 1] * boxH
          if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
      }
      canvas.drawPath(path, paint)
    }
    return bmp
  }
}
