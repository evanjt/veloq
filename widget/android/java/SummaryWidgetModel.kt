package __PKG__.widget

/** The sizes every widget draws at; a placement one row tall is SHORT whatever its width. */
enum class SummarySize {
  SHORT,
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
 * What one placed widget was configured with. Every field unset follows the app's card, so a
 * widget placed before the picker existed, and one whose picker was dismissed, keeps the card.
 */
data class SummaryPlacement(
  /** A hero id from the card's list, or null to follow the card. */
  val hero: String? = null,
  /** True shows the hero's chart, false hides it, null follows the card. */
  val sparkline: Boolean? = null,
  /** Metric ids in order, at most four. Empty follows the card. */
  val supporting: List<String> = emptyList(),
)

/** One row of the picker: the id a placement stores and the name the snapshot gives it. */
data class SummaryOption(val id: String, val label: String)

/**
 * What the Summary widget draws, decided from the snapshot alone. It holds no Android type, so
 * the choices run on the JVM: which card a placement shows, which entries each size lists, which
 * chart sits beside the hero.
 *
 * The card is the in-app summary card the snapshot carries. A placement may choose a hero among
 * the card's own heroes, a sparkline setting and a supporting row among the metrics the snapshot
 * carries; anything it leaves unset follows the card. A chosen hero moves the card's hero into
 * the supporting row rather than dropping it.
 */
object SummaryWidget {
  const val SUPPORTING_MAX = 4

  /** The metrics every snapshot carries a reading for, whatever its card or metric list holds. */
  private val HEADLINE_IDS = listOf("form", "fitness", "fatigue", "hrv", "rhr")
  private val FORM_ZONES = listOf("highRisk", "optimal", "greyZone", "fresh", "transition")

  /**
   * A launcher reports a row as 51dp tall and two as 117dp, so anything under this is one row. A
   * host that has not reported a size yet gives 0, which is not a row.
   */
  const val SHORT_BELOW_DP = 100

  fun isShort(heightDp: Int): Boolean = heightDp in 1 until SHORT_BELOW_DP

  fun sizeFor(widthDp: Int, heightDp: Int): SummarySize =
    when {
      isShort(heightDp) -> SummarySize.SHORT
      heightDp >= 200 && widthDp >= 200 -> SummarySize.LARGE
      widthDp >= 200 -> SummarySize.MEDIUM
      else -> SummarySize.SMALL
    }

  /** The heroes the picker offers, which are the card's own, named as the snapshot names them. */
  fun heroChoices(snap: WidgetSnapshot): List<SummaryOption> {
    val base = snap.summaryCard ?: fallbackCard(snap)
    return snap.summaryHeroes.mapNotNull { id -> entry(snap, base, id)?.let { SummaryOption(id, it.label) } }
  }

  /** The supporting metrics the picker offers: every one the snapshot carries, in the card's order. */
  fun supportingChoices(snap: WidgetSnapshot): List<SummaryOption> =
    snap.summaryMetrics.map { SummaryOption(it.id, it.label) }

  /** The entries under the hero: none on Short and Small, up to four otherwise, in the card's order. */
  fun supporting(card: SummaryCard, size: SummarySize): List<SummaryEntry> =
    if (size == SummarySize.SHORT || size == SummarySize.SMALL) emptyList() else card.entries.take(SUPPORTING_MAX)

  /** The card a placement draws. A hero the card does not offer follows the card's own. */
  fun card(snap: WidgetSnapshot, placement: SummaryPlacement): SummaryCard {
    val base = snap.summaryCard ?: fallbackCard(snap)
    val hero =
      placement.hero
        ?.takeIf { it in snap.summaryHeroes && it != base.hero.id }
        ?.let { entry(snap, base, it) }
        ?: base.hero

    val entries =
      if (placement.supporting.isEmpty()) {
        (listOf(base.hero) + base.entries).filter { it.id != hero.id }.take(SUPPORTING_MAX)
      } else {
        placement.supporting.distinct().mapNotNull { entry(snap, base, it) }.take(SUPPORTING_MAX)
      }

    val shows = placement.sparkline ?: (base.sparkline != "none")
    return SummaryCard(
      hero = hero,
      entries = entries,
      sparkline =
        when {
          !shows -> "none"
          hero.id == "hrv" -> "hrv"
          else -> "fitnessForm"
        },
      heroSparkline =
        when {
          !shows -> emptyList()
          hero.id == base.hero.id -> base.heroSparkline
          hero.id == "hrv" -> snap.hrvSparkline
          else -> emptyList()
        },
    )
  }

  /** A snapshot with no card (disabled in the app, or written before it) still has form and four metrics. */
  private fun fallbackCard(snap: WidgetSnapshot): SummaryCard =
    SummaryCard(
      hero = metricEntry(snap, "form"),
      entries = listOf("fitness", "fatigue", "hrv", "rhr").map { metricEntry(snap, it) },
      sparkline = "fitnessForm",
    )

  /**
   * One metric by id: the snapshot's list of every summary metric first, then what the card
   * already holds, then the headline metrics every snapshot carries.
   */
  private fun entry(snap: WidgetSnapshot, base: SummaryCard, id: String): SummaryEntry? =
    snap.summaryMetrics.firstOrNull { it.id == id }
      ?: (listOf(base.hero) + base.entries).firstOrNull { it.id == id }
      ?: id.takeIf { it in HEADLINE_IDS }?.let { metricEntry(snap, it) }

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
      spoken = m.spoken,
      colorKey =
        when (id) {
          "form" -> "formZone"
          "fitness" -> "blue"
          "fatigue" -> "fatigue"
          else -> "default"
        },
    )
  }

  /**
   * The arrow the engine's trend glyph names, the one the app draws beside the same number. Flat
   * is drawn rather than left blank, and a direction this build does not know draws flat.
   */
  fun trendArrow(dir: String): String =
    when (dir) {
      "up" -> "↑"
      "down" -> "↓"
      else -> "→"
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
