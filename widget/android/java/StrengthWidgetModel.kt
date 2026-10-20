package __PKG__.widget

/** One trained muscle and its shade, 1 (lightest) to [StrengthWidget.SHADES]. */
data class StrengthMuscleShade(val slug: String, val shade: Int)

/** One of the most trained muscles, named and worded as the strength tab words it. */
data class StrengthTopMuscle(
  val slug: String,
  val name: String,
  val setsText: String,
  /** Null for bodyweight work, which moved no recorded weight. */
  val volumeText: String?,
  /** How often a week the muscle was trained, as the engine words it; null on an older snapshot. */
  val frequencyText: String? = null,
) {
  /**
   * The row under the name: how often a week, then the sets, then the volume, so the volume is the
   * part the line's ellipsis cuts when the row is short of room.
   */
  val detail: String
    get() = listOfNotNull(frequencyText, setsText.ifEmpty { null }, volumeText).joinToString(" · ")
}

/** One window of the strength diagram as the engine shaded and ranked it. */
data class StrengthWindow(
  /** What the widget calls the window. */
  val label: String,
  val muscles: List<StrengthMuscleShade>,
  val top: List<StrengthTopMuscle>,
  /** The words drawn in place of the body when the window has no strength sessions. */
  val emptyText: String?,
  /**
   * What the shaded body shows, as a screen reader says it: the most trained muscles and their
   * sets. Null where no body is drawn, and on a snapshot written before schema 16.
   */
  val bodyLabel: String? = null,
)

/** The snapshot's strength block: the athlete's body, where a tap goes and the trailing 30 days. */
data class StrengthBlock(
  val female: Boolean,
  val url: String,
  val window: StrengthWindow,
)

/** What a Strength widget draws at one size. */
data class StrengthContent(
  val label: String,
  val female: Boolean,
  /** The sides of the body to draw, left to right; none when [emptyText] replaces the body. */
  val sides: List<BodyOutline.Side>,
  val top: List<StrengthTopMuscle>,
  val emptyText: String?,
  /** What a screen reader says for the body. */
  val bodyLabel: String?,
  val url: String,
  val demoLabel: String?,
  private val shades: Map<String, Int>,
) {
  /** The ramp step a part is filled with, or 0 for the body fill a part nobody trained takes. */
  fun shadeOf(slug: String): Int = shades[slug] ?: 0
}

/**
 * What the Strength widget draws, decided from the snapshot alone. It holds no Android type, so
 * the choices run on the JVM: which sides of the body a size has room for, and whether the
 * window's words replace the body. Every placement draws the trailing 30 days, the window the
 * strength tab opens on.
 */
object StrengthWidget {
  /** The steps of the palette's strength ramp. */
  const val SHADES = 5

  private const val TOP_MAX = 4

  /** The size classes are the Summary widget's, so every widget is small, medium or large alike. */
  fun sizeFor(widthDp: Int, heightDp: Int): SummarySize = SummaryWidget.sizeFor(widthDp, heightDp)

  /**
   * Null when the widget has nothing of the athlete's to draw: no snapshot yet, an empty library,
   * or a snapshot written before the strength block. Those draw the prompt every widget draws.
   */
  fun content(snap: WidgetSnapshot?, size: SummarySize): StrengthContent? {
    if (WidgetSnapshot.showsEmptyPrompt(snap)) return null
    val block = snap?.strength ?: return null
    val window = block.window
    // An unshaded body would read as no load at all, so the words take its place.
    val drawsBody = window.emptyText == null
    val sides =
      when {
        !drawsBody -> emptyList()
        size == SummarySize.SHORT || size == SummarySize.SMALL -> listOf(BodyOutline.Side.FRONT)
        else -> listOf(BodyOutline.Side.FRONT, BodyOutline.Side.BACK)
      }
    return StrengthContent(
      label = window.label,
      female = block.female,
      sides = sides,
      top = if (drawsBody && size == SummarySize.LARGE) window.top.take(TOP_MAX) else emptyList(),
      emptyText = window.emptyText,
      bodyLabel = window.bodyLabel.takeIf { drawsBody },
      url = block.url,
      demoLabel = snap.demoLabel,
      shades =
        window.muscles
          .filter { it.shade > 0 }
          .associate { it.slug to it.shade.coerceAtMost(SHADES) },
    )
  }
}
