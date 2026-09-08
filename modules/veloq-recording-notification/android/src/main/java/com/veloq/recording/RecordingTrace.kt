package com.veloq.recording

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path

private const val WIDTH = 1024
private const val HEIGHT = 448
private const val PADDING = 48f
private const val STROKE = 10f

/**
 * The ride's trace, with no basemap. A notification cannot host a map view and
 * `RemoteViews` cannot draw an arbitrary path, so the trace is rasterised here
 * and handed over as a bitmap. Mercator is not worth it at this size; the
 * latitude scale is corrected by the cosine of the trace's own middle so a
 * north-south leg is not stretched against an east-west one.
 */
object RecordingTrace {
  fun render(flatLatLng: DoubleArray, color: Int): Bitmap? {
    if (flatLatLng.size < 4) return null

    var minLat = Double.MAX_VALUE
    var maxLat = -Double.MAX_VALUE
    var minLng = Double.MAX_VALUE
    var maxLng = -Double.MAX_VALUE
    var i = 0
    while (i + 1 < flatLatLng.size) {
      val lat = flatLatLng[i]
      val lng = flatLatLng[i + 1]
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      i += 2
    }

    val lngScale = Math.cos(Math.toRadians((minLat + maxLat) / 2)).coerceAtLeast(0.01)
    val spanX = ((maxLng - minLng) * lngScale).coerceAtLeast(1e-7)
    val spanY = (maxLat - minLat).coerceAtLeast(1e-7)
    // One scale for both axes, so the trace keeps its shape rather than filling
    // the frame in whichever direction the ride happened to be short.
    val scale = Math.min((WIDTH - 2 * PADDING) / spanX, (HEIGHT - 2 * PADDING) / spanY)
    val offsetX = (WIDTH - spanX * scale) / 2
    val offsetY = (HEIGHT - spanY * scale) / 2

    val path = Path()
    i = 0
    while (i + 1 < flatLatLng.size) {
      val x = (offsetX + (flatLatLng[i + 1] - minLng) * lngScale * scale).toFloat()
      // Screen y grows downward and latitude grows northward.
      val y = (offsetY + (maxLat - flatLatLng[i]) * scale).toFloat()
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
      i += 2
    }

    val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.TRANSPARENT)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = STROKE
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
      this.color = color
    }
    canvas.drawPath(path, paint)
    return bitmap
  }
}
