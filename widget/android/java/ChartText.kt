package __PKG__.widget

/**
 * The size of the labels a widget chart paints into its bitmap. A TextView's sp text follows the
 * reader's font scale on its own; a painted label follows it only through this.
 */
object ChartText {
  /**
   * An axis label in pixels: the caption size in sp at the reader's font scale, held to [maxScale]
   * times the caption, at the display's density.
   */
  fun axisLabelPx(captionSp: Float, density: Float, fontScale: Float, maxScale: Float): Float =
    captionSp * density * fontScale.coerceAtMost(maxScale)
}
