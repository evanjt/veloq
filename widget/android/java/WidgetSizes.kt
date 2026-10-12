package __PKG__.widget

/** One size a launcher may draw a placement at, in dp. */
data class WidgetSize(val widthDp: Int, val heightDp: Int)

/**
 * What a launcher reported for a placement, in dp. It reports a range rather than one size: a
 * portrait home screen draws the placement at the minimum width and the maximum height, a
 * landscape one at the maximum width and the minimum height, and from API 31 a launcher may list
 * every size it can draw the placement at. The two minimums together describe neither orientation.
 *
 * A host that reports no maximum gets its minimum in place of one, and a host that has not
 * reported yet gives zeros, which every widget model reads as unsized.
 */
data class ReportedSizes(
  val minWidth: Int,
  val minHeight: Int,
  val maxWidth: Int,
  val maxHeight: Int,
  val sizes: List<WidgetSize>,
) {
  val portrait: WidgetSize
    get() = WidgetSize(minWidth, maxOf(maxHeight, minHeight))

  val landscape: WidgetSize
    get() = WidgetSize(maxOf(maxWidth, minWidth), minHeight)

  /** Every size the placement may be drawn at: the launcher's own list where it gives one. */
  val all: List<WidgetSize>
    get() = sizes.ifEmpty { listOf(portrait, landscape) }.distinct()
}

object WidgetSizes {
  /**
   * One size per layout bucket, in the order the buckets first appear, since every bitmap a
   * drawing carries is paid for once per entry. Each is the smallest width and the smallest height
   * among the sizes in its bucket, so a launcher that picks the largest entry fitting its box finds
   * one whenever any of the bucket's sizes would fit, and what is drawn for it fits every one.
   * Where those two minimums fall in another bucket, the narrowest size in the bucket stands.
   */
  fun <B> oneEach(sizes: List<WidgetSize>, bucket: (WidgetSize) -> B): List<Pair<WidgetSize, B>> {
    val members = LinkedHashMap<B, MutableList<WidgetSize>>()
    for (size in sizes) members.getOrPut(bucket(size)) { mutableListOf() } += size
    return members.map { (b, inBucket) ->
      val least = WidgetSize(inBucket.minOf { it.widthDp }, inBucket.minOf { it.heightDp })
      val drawn =
        if (bucket(least) == b) least
        else inBucket.minWith(compareBy<WidgetSize> { it.widthDp }.thenBy { it.heightDp })
      drawn to b
    }
  }
}
