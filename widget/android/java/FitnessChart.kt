package __PKG__.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Renders the fitness trend chart to a Bitmap for RemoteViews. Mirrors the in-app
 * feed summary-card sparkline: monotone-cubic fitness and fatigue lines over a
 * shared domain, each with a dark casing under-stroke, and a per-day form zone bar
 * underneath. Adds a y-axis rail (min/max training-load values with gridlines) so
 * the scale is readable, as on intervals.icu. Values are oldest-first.
 */
object FitnessChart {
  data class ChartColors(
    val fitness: Int,
    val fatigue: Int,
    val casing: Int,
    val axisText: Int,
    val grid: Int,
    val divider: Int,
  )

  /** Feed-style chart: fitness + fatigue lines, form zone bar, axis rail. */
  fun fitnessBitmap(
    fitness: List<Float>,
    fatigue: List<Float>,
    zoneColors: List<Int>,
    widthPx: Int,
    heightPx: Int,
    density: Float,
    colors: ChartColors,
  ): Bitmap {
    val w = max(1, widthPx)
    val h = max(1, heightPx)
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    if (fitness.size < 2 && fatigue.size < 2) return bmp
    val canvas = Canvas(bmp)

    val all = fitness + fatigue
    val rawMin = all.min()
    val rawMax = all.max()
    val plot = layoutPlot(canvas, w, h, density, colors, rawMin, rawMax, zoneColors.isNotEmpty())

    drawFormBar(canvas, plot, zoneColors, density, colors.divider)
    if (fatigue.size >= 2) {
      drawLine(canvas, plot, fatigue, colors.casing, 2f * density)
      drawLine(canvas, plot, fatigue, colors.fatigue, 1f * density)
    }
    if (fitness.size >= 2) {
      drawLine(canvas, plot, fitness, colors.casing, 2f * density)
      drawLine(canvas, plot, fitness, colors.fitness, 1.5f * density)
    }
    return bmp
  }

  /** Single-series variant (HRV): one cased line with a faint fill, same axis rail. */
  fun singleBitmap(
    values: List<Float>,
    lineColor: Int,
    widthPx: Int,
    heightPx: Int,
    density: Float,
    colors: ChartColors,
    fillAlpha: Int = 38,
  ): Bitmap {
    val w = max(1, widthPx)
    val h = max(1, heightPx)
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    if (values.size < 2) return bmp
    val canvas = Canvas(bmp)

    val plot = layoutPlot(canvas, w, h, density, colors, values.min(), values.max(), false)
    drawFill(canvas, plot, values, lineColor, fillAlpha)
    drawLine(canvas, plot, values, colors.casing, 2f * density)
    drawLine(canvas, plot, values, lineColor, 1.5f * density)
    return bmp
  }

  // Plot geometry plus the y domain (buffered like the feed chart so casing strokes
  // at the extremes aren't clipped).
  private class Plot(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
    val domainMin: Float,
    val domainMax: Float,
    val barTop: Float,
  ) {
    fun yOf(v: Float): Float = top + (1f - (v - domainMin) / (domainMax - domainMin)) * (bottom - top)
  }

  // Draws the axis rail (gridlines + value labels in the left gutter) and returns
  // the remaining plot rect.
  private fun layoutPlot(
    canvas: Canvas,
    w: Int,
    h: Int,
    density: Float,
    colors: ChartColors,
    rawMin: Float,
    rawMax: Float,
    hasFormBar: Boolean,
  ): Plot {
    val text =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colors.axisText
        textSize = 9f * density
      }
    val grid =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colors.grid
        strokeWidth = 1f
      }

    val minLabel = rawMin.roundToInt().toString()
    val maxLabel = rawMax.roundToInt().toString()
    val gutter = max(text.measureText(minLabel), text.measureText(maxLabel)) + 4f * density

    val pad = 2f * density
    val barH = 4f * density
    val barGap = 2f * density
    val bottom = if (hasFormBar) h - barH - barGap else h - pad
    val range = (rawMax - rawMin).takeIf { it > 0f } ?: 1f
    val plot =
      Plot(
        left = gutter,
        top = pad,
        right = w - pad,
        bottom = bottom,
        domainMin = rawMin - range * 0.06f,
        domainMax = rawMax + range * 0.04f,
        barTop = h - barH,
      )

    val textH = text.fontMetrics.let { it.descent - it.ascent }
    for ((value, label) in listOf(rawMax to maxLabel, rawMin to minLabel)) {
      val y = plot.yOf(value)
      canvas.drawLine(plot.left, y, plot.right, y, grid)
      val baseline = (y + textH / 2f - text.fontMetrics.descent).coerceIn(textH * 0.8f, h - 2f)
      canvas.drawText(label, gutter - 4f * density - text.measureText(label), baseline, text)
    }
    return plot
  }

  private fun xPositions(plot: Plot, n: Int): FloatArray {
    val step = (plot.right - plot.left) / (n - 1)
    return FloatArray(n) { plot.left + it * step }
  }

  private fun drawLine(canvas: Canvas, plot: Plot, values: List<Float>, colorInt: Int, width: Float) {
    val xs = xPositions(plot, values.size)
    val ys = FloatArray(values.size) { plot.yOf(values[it]) }
    val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colorInt
        style = Paint.Style.STROKE
        strokeWidth = width
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
      }
    canvas.drawPath(monotonePath(xs, ys), paint)
  }

  private fun drawFill(canvas: Canvas, plot: Plot, values: List<Float>, colorInt: Int, alpha: Int) {
    if (alpha <= 0) return
    val xs = xPositions(plot, values.size)
    val ys = FloatArray(values.size) { plot.yOf(values[it]) }
    val path = monotonePath(xs, ys)
    path.lineTo(xs.last(), plot.bottom)
    path.lineTo(xs.first(), plot.bottom)
    path.close()
    val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colorInt
        style = Paint.Style.FILL
      }
    paint.alpha = alpha
    canvas.drawPath(path, paint)
  }

  // Per-day zone rectangles merged into contiguous runs, split by 1dp dividers, with
  // run edges at the midpoints between chart x positions (same geometry as the feed).
  private fun drawFormBar(
    canvas: Canvas,
    plot: Plot,
    zoneColors: List<Int>,
    density: Float,
    dividerColor: Int,
  ) {
    val n = zoneColors.size
    if (n == 0) return
    val step = if (n > 1) (plot.right - plot.left) / (n - 1) else plot.right - plot.left
    val paint = Paint()
    val divider = Paint().apply { color = dividerColor }
    val bottom = plot.barTop + 4f * density

    var runStart = 0
    for (i in 1..n) {
      if (i == n || zoneColors[i] != zoneColors[runStart]) {
        val left = if (runStart == 0) plot.left else plot.left + (runStart - 0.5f) * step
        val right = if (i == n) plot.right else plot.left + (i - 0.5f) * step
        paint.color = zoneColors[runStart]
        canvas.drawRect(left, plot.barTop, right, bottom, paint)
        if (i < n) canvas.drawRect(right - density / 2f, plot.barTop, right + density / 2f, bottom, divider)
        runStart = i
      }
    }
  }

  // d3-shape curveMonotoneX port, so the widget curve matches the in-app chart.
  private fun sign(x: Float) = if (x < 0f) -1f else 1f

  private fun slope3(x0: Float, y0: Float, x1: Float, y1: Float, x2: Float, y2: Float): Float {
    val h0 = x1 - x0
    val h1 = x2 - x1
    val s0 = (y1 - y0) / if (h0 != 0f) h0 else Float.MIN_VALUE
    val s1 = (y2 - y1) / if (h1 != 0f) h1 else Float.MIN_VALUE
    val p = (s0 * h1 + s1 * h0) / (h0 + h1)
    val m = (sign(s0) + sign(s1)) * minOf(abs(s0), abs(s1), 0.5f * abs(p))
    return if (m.isFinite()) m else 0f
  }

  private fun slope2(x0: Float, y0: Float, x1: Float, y1: Float, t: Float): Float {
    val h = x1 - x0
    return if (h != 0f) (3f * (y1 - y0) / h - t) / 2f else t
  }

  private fun bezier(path: Path, x0: Float, y0: Float, x1: Float, y1: Float, t0: Float, t1: Float) {
    val dx = (x1 - x0) / 3f
    path.cubicTo(x0 + dx, y0 + dx * t0, x1 - dx, y1 - dx * t1, x1, y1)
  }

  private fun monotonePath(xs: FloatArray, ys: FloatArray): Path {
    val n = xs.size
    val path = Path()
    path.moveTo(xs[0], ys[0])
    if (n == 2) {
      path.lineTo(xs[1], ys[1])
      return path
    }
    var t0 = 0f
    for (i in 2 until n) {
      val t1 = slope3(xs[i - 2], ys[i - 2], xs[i - 1], ys[i - 1], xs[i], ys[i])
      val start = if (i == 2) slope2(xs[0], ys[0], xs[1], ys[1], t1) else t0
      bezier(path, xs[i - 2], ys[i - 2], xs[i - 1], ys[i - 1], start, t1)
      t0 = t1
    }
    bezier(
      path, xs[n - 2], ys[n - 2], xs[n - 1], ys[n - 1], t0,
      slope2(xs[n - 2], ys[n - 2], xs[n - 1], ys[n - 1], t0))
    return path
  }
}
