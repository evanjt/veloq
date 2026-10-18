package __PKG__.widget

/**
 * How a widget chart strokes one series, in pixels. A line holds 3:1 on its own, so none draws a
 * casing under it, and fatigue is dashed so it reads apart from fitness without its colour.
 */
object ChartStroke {
  /** A width and, for a dashed line, its on and off lengths. */
  data class Stroke(val width: Float, val dash: List<Float>?)

  /** The fitness line, and the single series a chart draws alone. */
  fun solid(density: Float): Stroke = Stroke(1.5f * density, null)

  /** The fatigue line, dashed by the theme's lengths in dp, the ones its legend mark draws. */
  fun fatigue(density: Float, dashDp: List<Float>): Stroke =
    Stroke(1f * density, dashDp.takeIf { it.isNotEmpty() }?.map { it * density })
}
