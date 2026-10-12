package __PKG__.widget

/** One insight row, as the Insights tab words it and as the app ranked it. */
data class WidgetInsight(
  val id: String,
  /** The tab's category, which the placement's kind pick filters on. */
  val category: String,
  val title: String,
  val subtitle: String,
  /** The tab's icon name; carried so a later glyph set needs no new snapshot. */
  val icon: String,
  /** The tab's tone: a verdict rung, `info` or `opportunity`. */
  val tone: String,
  /** Where a tap on the row goes. */
  val url: String,
  /**
   * The tone as a screen reader says it, since the row draws it as a colour alone. Null on a
   * snapshot written before schema 16.
   */
  val toneLabel: String? = null,
)

/** What an Insights widget draws at one size: its rows, and how many more the list holds. */
data class InsightsContent(val rows: List<WidgetInsight>, val more: Int)

/**
 * What the Insights widget draws, decided from the snapshot alone. It holds no Android type, so
 * the choices run on the JVM: how many rows a size lists, which kinds a placement keeps, and how
 * many rows the largest size has no room for.
 *
 * The snapshot carries the Insights tab's list in the tab's order and of every kind. Each placed
 * widget filters it for itself, so one snapshot serves every placement.
 */
object InsightsWidget {
  /** The kinds the app ranks, in the order the picker lists them. */
  val KINDS =
    listOf(
      "section_pr",
      "section_trend",
      "route",
      "stale_pr",
      "fitness_milestone",
      "period_comparison",
      "strength_progression",
      "strength_balance",
      "hrv_trend",
      "efficiency_trend",
      "section_changed",
    )

  /** Where a tap on the count of further rows goes: the Insights tab. */
  const val TAB_URL = "veloq://insights"

  /** The size classes are the Summary widget's, so every widget is small, medium or large alike. */
  fun sizeFor(widthDp: Int, heightDp: Int): SummarySize = SummaryWidget.sizeFor(widthDp, heightDp)

  fun rowsFor(size: SummarySize): Int =
    when (size) {
      SummarySize.SHORT, SummarySize.SMALL -> 1
      SummarySize.MEDIUM -> 2
      SummarySize.LARGE -> 4
    }

  /**
   * A kind pick as it is stored: null follows every kind, which is also what an empty pick and one
   * naming no kind the app ranks mean, since a widget that lists nothing is not a choice.
   */
  fun normalise(picked: Collection<String>): Set<String>? {
    val known = picked.filter { it in KINDS }.toSet()
    return if (known.isEmpty() || known.size == KINDS.size) null else known
  }

  fun content(snap: WidgetSnapshot, size: SummarySize, kinds: Set<String>?): InsightsContent {
    val keep = kinds?.let { normalise(it) }
    val matching = snap.insights.filter { keep == null || it.category in keep }
    val shown = rowsFor(size)
    return InsightsContent(
      rows = matching.take(shown),
      more = if (size == SummarySize.LARGE) (matching.size - shown).coerceAtLeast(0) else 0,
    )
  }
}
