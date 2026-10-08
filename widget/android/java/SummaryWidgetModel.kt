package __PKG__.widget

/** The three layouts of the Summary widget. */
enum class SummarySize {
  SMALL,
  MEDIUM,
  LARGE,
}

/** What the trend image beside the hero draws. */
sealed class SummaryChart {
  object None : SummaryChart()

  /** Fitness and fatigue over one shared domain. */
  data class Dual(val fitness: List<Float>, val fatigue: List<Float>) : SummaryChart()

  /** One series with a faint fill. */
  data class Single(val values: List<Float>) : SummaryChart()
}

/** One form zone of the large chart: where it starts and ends in the chart's unit. */
data class FormBand(val zone: String, val from: Float, val to: Float)

/**
 * Six weeks of form over its five zones: the bands run from the chart's floor to its ceiling,
 * which hold every value and every zone, so a run of days inside one zone still shows the rest.
 */
data class FormZoneChart(
  val values: List<Float?>,
  val bands: List<FormBand>,
  val min: Float,
  val max: Float,
)

/**
 * What the Summary widget draws, decided from the snapshot alone. It holds no Android type, so
 * the choices run on the JVM: which card a placement shows, which entries each size lists, which
 * chart sits beside the hero.
 *
 * The card is the in-app summary card the snapshot carries. A placement may choose a hero of its
 * own among the metrics every snapshot holds; the card's hero then moves into the supporting row
 * rather than dropping out, and the card's sparkline setting still decides whether a chart shows.
 */
object SummaryWidget {
  /** The stored choice that follows the app's card, and the label the picker gives it. */
  const val FOLLOW_CARD = "summary"

  /** The heroes a placement can choose, which are the metrics every snapshot carries. */
  val HERO_CHOICES = listOf("form", "fitness", "fatigue", "hrv", "rhr")

  private const val SUPPORTING_MAX = 4
  private val FORM_ZONES = listOf("highRisk", "optimal", "greyZone", "fresh", "transition")

  fun sizeFor(widthDp: Int, heightDp: Int): SummarySize =
    when {
      heightDp >= 200 && widthDp >= 200 -> SummarySize.LARGE
      widthDp >= 200 -> SummarySize.MEDIUM
      else -> SummarySize.SMALL
    }

  /** The entries under the hero: none on Small, up to four otherwise, in the card's order. */
  fun supporting(card: SummaryCard, size: SummarySize): List<SummaryEntry> =
    if (size == SummarySize.SMALL) emptyList() else card.entries.take(SUPPORTING_MAX)

  /** The card a placement draws, given what it was configured with (null follows the app). */
  fun card(snap: WidgetSnapshot, choice: String?): SummaryCard {
    val base = snap.summaryCard ?: fallbackCard(snap)
    if (choice == null || choice !in HERO_CHOICES || choice == base.hero.id) return base

    val hero = metricEntry(snap, choice)
    val entries = (listOf(base.hero) + base.entries).filter { it.id != choice }.take(SUPPORTING_MAX)
    val sparkline =
      when {
        base.sparkline == "none" -> "none"
        choice == "hrv" -> "hrv"
        else -> "fitnessForm"
      }
    return SummaryCard(
      hero = hero,
      entries = entries,
      sparkline = sparkline,
      heroSparkline = if (choice == "hrv" && sparkline != "none") snap.hrvSparkline else emptyList(),
    )
  }

  /** A snapshot with no card (disabled in the app, or written before it) still has form and four metrics. */
  private fun fallbackCard(snap: WidgetSnapshot): SummaryCard =
    SummaryCard(
      hero = metricEntry(snap, "form"),
      entries = listOf("fitness", "fatigue", "hrv", "rhr").map { metricEntry(snap, it) },
      sparkline = "fitnessForm",
    )

  private fun metricEntry(snap: WidgetSnapshot, id: String): SummaryEntry {
    val m =
      when (id) {
        "form" -> snap.form
        "fitness" -> snap.fitness
        "fatigue" -> snap.fatigue
        "hrv" -> snap.hrv
        else -> snap.rhr
      }
    return SummaryEntry(
      id = id,
      label = snap.metricLabels[id] ?: id.replaceFirstChar { it.uppercase() },
      value = m.display(),
      trendDir = m.trendDir,
      verdict = m.verdict,
      colorKey =
        when (id) {
          "form" -> "formZone"
          "fitness" -> "blue"
          "fatigue" -> "fatigue"
          else -> "default"
        },
    )
  }

  /** The line under the hero's value: the form zone where the hero is form, nothing otherwise. */
  fun heroLine(snap: WidgetSnapshot, card: SummaryCard): String? =
    if (card.hero.id == "form") snap.formZoneLabel else null

  fun chart(snap: WidgetSnapshot, card: SummaryCard): SummaryChart =
    when (card.sparkline) {
      "hrv" -> {
        val series = card.heroSparkline.takeIf { it.size >= 2 } ?: snap.hrvSparkline
        if (series.size >= 2) SummaryChart.Single(series) else SummaryChart.None
      }
      "fitnessForm" ->
        if (snap.fitnessSparkline.size >= 2) {
          SummaryChart.Dual(snap.fitnessSparkline, snap.fatigueSparkline)
        } else {
          SummaryChart.None
        }
      else -> SummaryChart.None
    }

  /** The large chart, absent without two measured days or without the four zone bounds. */
  fun formZones(snap: WidgetSnapshot): FormZoneChart? {
    val history = snap.formHistory ?: return null
    val measured = history.values.filterNotNull()
    if (measured.size < 2 || history.zoneBounds.size != FORM_ZONES.size - 1) return null

    val bounds = history.zoneBounds.map { it.toFloat() }
    val low = minOf(measured.min(), bounds.first())
    val high = maxOf(measured.max(), bounds.last())
    val pad = ((high - low) * 0.08f).coerceAtLeast(2f)
    val floor = low - pad
    val ceiling = high + pad

    val edges = listOf(floor) + bounds + listOf(ceiling)
    return FormZoneChart(
      values = history.values,
      bands = FORM_ZONES.mapIndexed { i, zone -> FormBand(zone, edges[i], edges[i + 1]) },
      min = floor,
      max = ceiling,
    )
  }
}
