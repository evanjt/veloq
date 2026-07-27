package __PKG__.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.max
import kotlin.math.min

/**
 * Draws the snapshot's normalised route outline into a Bitmap for RemoteViews.
 * Points are 0..1 with y growing downward; the track is letterboxed into the
 * bitmap preserving its projected aspect ratio.
 */
object RoutePreviewBitmap {
  fun render(preview: RoutePreview, widthPx: Int, heightPx: Int, colorInt: Int): Bitmap {
    val w = max(1, widthPx)
    val h = max(1, heightPx)
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    if (preview.points.size < 2) return bmp

    val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colorInt
        style = Paint.Style.STROKE
        strokeWidth = min(w, h) * 0.05f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
      }

    val pad = paint.strokeWidth
    val usableW = (w - pad * 2).coerceAtLeast(1f)
    val usableH = (h - pad * 2).coerceAtLeast(1f)

    // Letterbox: fit the track's aspect box inside the usable area.
    val aspect = if (preview.aspect > 0) preview.aspect else 1f
    var boxW = usableW
    var boxH = usableH
    if (aspect > usableW / usableH) {
      boxH = boxW / aspect
    } else {
      boxW = boxH * aspect
    }
    val ox = pad + (usableW - boxW) / 2f
    val oy = pad + (usableH - boxH) / 2f

    val path = Path()
    preview.points.forEachIndexed { i, (x, y) ->
      val px = ox + x * boxW
      val py = oy + y * boxH
      if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
    }
    Canvas(bmp).drawPath(path, paint)
    return bmp
  }
}
