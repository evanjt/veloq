package __PKG__.widget

import kotlin.math.roundToInt

/** The sizes every widget draws at; a placement one row tall is SHORT whatever its width. */
enum class SummarySize {
  SHORT,
  SMALL,
  MEDIUM,
  LARGE,
}

/** What the hero's trend image draws. */
sealed class SummaryChart {
  object None : SummaryChart()

  /** Fitness and fatigue over one shared domain. */
  data class Dual(val fitness: List<Float>, val fatigue: List<Float>) : SummaryChart()

  /** One series with a faint fill. */
  data class Single(val values: List<Float>) : SummaryChart()
}

/**
 * The words drawn under the hero's chart: its series in the order its lines are drawn
 * apart, solid then dashed, and the days it spans. A single series is named by the hero beside
 * it, so it lists none.
 */
data class ChartCaption(val series: List<String>, val span: String?)

/** The words drawn over the form chart: its name, the zone the latest day sits in, its span. */
data class FormChartCaption(val title: String, val zone: String?, val span: String?)

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

/** A size's layout and, on Large, the height in dp its form strip is drawn at, else 0. */
data class SummaryLayout(val size: SummarySize, val formStripDp: Int)

/** One row of the picker: the id a placement stores and the name the snapshot gives it. */
data class SummaryOption(val id: String, val label: String)

/**
 * What the Summary widget draws, decided from the snapshot alone. It holds no Android type, so
 * the choices run on the JVM: which card a placement shows, which entries each size lists, which
 * chart the hero draws.
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

  /** Training load, in the order the hero's line names it. */
  private val TRAINING_LOAD_IDS = listOf("fitness", "fatigue", "form")

  /**
   * A launcher reports a row as 51dp tall and two as 117dp, so anything under this is one row. A
   * host that has not reported a size yet gives 0, which is not a row.
   */
  const val SHORT_BELOW_DP = 100

  fun isShort(heightDp: Int): Boolean = heightDp in 1 until SHORT_BELOW_DP

  /** The width from which a placement two rows tall draws Medium rather than Small. */
  const val WIDE_FROM_DP = 200

  fun sizeFor(widthDp: Int, heightDp: Int): SummarySize =
    when {
      isShort(heightDp) -> SummarySize.SHORT
      heightDp >= 200 && widthDp >= WIDE_FROM_DP -> SummarySize.LARGE
      widthDp >= WIDE_FROM_DP -> SummarySize.MEDIUM
      else -> SummarySize.SMALL
    }

  /**
   * The least height the Medium card draws its chart legend at. The card stacks the head, the
   * chart, its legend, the supporting row and the age row, and only the chart gives way, so below
   * this the chart has no room and a legend under it would name nothing. The parts, in dp: the
   * card's top and bottom gap (16), the head's label, value and form line (59), the chart's top
   * margin (4), the least chart that still reads as one (16), the legend's one line (14), the rule
   * above the supporting row (5), that row's label and value (30) and the age row (48).
   */
  const val CAPTIONED_MEDIUM_MIN_DP = 16 + 59 + 4 + 16 + 14 + 5 + 30 + 48

  /**
   * Whether a size names its chart's series and span under it. Small and Short have no room for
   * them; Medium has room only from [CAPTIONED_MEDIUM_MIN_DP] up, so a one-row placement a launcher
   * reports as Medium keeps the card without a legend. A host that has not reported a height yet
   * gives 0 and keeps the legend.
   */
  fun captionsChart(size: SummarySize, heightDp: Int): Boolean =
    when (size) {
      SummarySize.SHORT, SummarySize.SMALL -> false
      SummarySize.MEDIUM -> heightDp == 0 || heightDp >= CAPTIONED_MEDIUM_MIN_DP
      SummarySize.LARGE -> true
    }

  /**
   * Whether a placement draws the refresh control. Under [WIDE_FROM_DP] the hero's name, value
   * and arrow take the whole line, so the control gives way: a tap on the widget opens the app,
   * which refreshes.
   */
  fun showsRefresh(widthDp: Int): Boolean = widthDp >= WIDE_FROM_DP

  /** The form strip's height on a placement the host has not sized yet. */
  const val FORM_STRIP_UNSIZED_DP = 96

  /** The form strip's floor, the minimum height the Large layout holds it to. */
  const val FORM_STRIP_MIN_DP = 48

  /**
   * What Large draws around the form strip at a fixed size, in dp: the padding at top and bottom,
   * the chart under the head and its top margin, the divider and the two gaps around it, the gap
   * over the strip's title and the 48dp refresh target in the age row.
   */
  private const val LARGE_FIXED_DP = 32f + 52f + 4f + 1f + 16f + 8f + 48f

  /**
   * What Large draws around the form strip in text, in sp: the head's label line, its value in a
   * metric line and the form zone under it in a caption line, the chart's one-line legend, a
   * supporting cell's label and the strip's title in caption lines, and a cell's value in a label
   * line. The hero's column is the tallest part of the head, so it is the one counted.
   */
  private const val LARGE_TEXT_SP = 11f + 22f + 10f * 4 + 11f

  /** A line of the widget face, its ascent and descent over its em. */
  private const val LINE_HEIGHT = 1.366f

  /**
   * The height the form strip is left on a Large placement [heightDp] tall, at the reader's
   * [fontScale]: the placement less everything above and below it. The strip is drawn into a
   * bitmap, so this is the height it is drawn at; a bitmap drawn at any other height is scaled to
   * the view, and its axis labels with it.
   */
  fun formStripDp(heightDp: Int, fontScale: Float): Int {
    if (heightDp <= 0) return FORM_STRIP_UNSIZED_DP
    val around = LARGE_FIXED_DP + LARGE_TEXT_SP * LINE_HEIGHT * fontScale
    return (heightDp - around).roundToInt().coerceAtLeast(FORM_STRIP_MIN_DP)
  }

  /**
   * The layout a size draws and, on Large, the form strip's height, so that two Large sizes whose
   * strips differ are drawn once each rather than one bitmap stretched to both.
   */
  fun layoutFor(widthDp: Int, heightDp: Int, fontScale: Float): SummaryLayout {
    val size = sizeFor(widthDp, heightDp)
    val strip = if (size == SummarySize.LARGE) formStripDp(heightDp, fontScale) else 0
    return SummaryLayout(size, strip)
  }

  /** The heroes the picker offers, which are the card's own, named as the snapshot names them. */
  fun heroChoices(snap: WidgetSnapshot): List<SummaryOption> {
    val base = snap.summaryCard ?: fallbackCard(snap)
    return snap.summaryHeroes.mapNotNull { id -> entry(snap, base, id)?.let { SummaryOption(id, it.label) } }
  }

  /** The supporting metrics the picker offers: every one the snapshot carries, in the card's order. */
  fun supportingChoices(snap: WidgetSnapshot): List<SummaryOption> =
    snap.summaryMetrics.map { SummaryOption(it.id, it.label) }

  /**
   * The entries under the hero: none on Short and Small, up to four otherwise, in the card's order.
   * An entry already drawn [beside] the hero is left out, so no value is drawn twice.
   */
  fun supporting(
    card: SummaryCard,
    size: SummarySize,
    beside: List<SummaryEntry> = emptyList(),
  ): List<SummaryEntry> =
    if (size == SummarySize.SHORT || size == SummarySize.SMALL) {
      emptyList()
    } else {
      card.entries.filter { e -> beside.none { it.id == e.id } }.take(SUPPORTING_MAX)
    }

  /**
   * The other two readings of training load, drawn on the hero's line from Medium up when the hero
   * is one of them, in the order fitness, fatigue, form. The hero's chart plots fitness
   * and fatigue and names neither value, so these say what it stands at today. Short and Small
   * have no room beside the value, and a hero outside training load carries none.
   */
  fun trainingLoad(snap: WidgetSnapshot, card: SummaryCard, size: SummarySize): List<SummaryEntry> {
    if (size == SummarySize.SHORT || size == SummarySize.SMALL) return emptyList()
    if (card.hero.id !in TRAINING_LOAD_IDS) return emptyList()
    return TRAINING_LOAD_IDS.filter { it != card.hero.id }.mapNotNull { entry(snap, card, it) }
  }

  /**
   * The record button rides from Medium up. Small and Short have no room beside the labelled
   * value, and on Small one tap is the whole widget.
   */
  fun carriesRecord(size: SummarySize): Boolean =
    size == SummarySize.MEDIUM || size == SummarySize.LARGE

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
   * What the key dot beside a value is coloured by: the `blue` or `fatigue` series, or the zone
   * form sits in. The value itself is primary text. An entry with no measure colour, or a zone
   * this build does not know, draws no dot.
   */
  fun keyTone(colorKey: String, formZone: String?): String? =
    when (colorKey) {
      "blue", "fatigue" -> colorKey
      "formZone" -> formZone?.takeIf { it in FORM_ZONES }
      else -> null
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

  /** The series [chart] draws, named as the snapshot names them, and the days it spans. */
  fun chartCaption(snap: WidgetSnapshot, chart: SummaryChart): ChartCaption? =
    when (chart) {
      SummaryChart.None -> null
      is SummaryChart.Dual -> {
        val fitness = snap.metricLabels["fitness"] ?: "Fitness"
        val fatigue = snap.metricLabels["fatigue"] ?: "Fatigue"
        ChartCaption(
          series = if (chart.fatigue.size >= 2) listOf(fitness, fatigue) else listOf(fitness),
          span = snap.chartSpans.fitness,
        )
      }
      is SummaryChart.Single -> ChartCaption(series = emptyList(), span = snap.chartSpans.hrv)
    }

  /** The form chart's name, today's zone and its span. */
  fun formCaption(snap: WidgetSnapshot): FormChartCaption =
    FormChartCaption(
      title = snap.metricLabels["form"] ?: "Form",
      zone = snap.formZoneLabel?.takeIf { it.isNotEmpty() },
      span = snap.chartSpans.form,
    )

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
