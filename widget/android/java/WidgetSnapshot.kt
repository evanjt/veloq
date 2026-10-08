package __PKG__.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToInt

/**
 * The pre-computed, pre-formatted snapshot the JS side writes to filesDir. The widget
 * only renders this, it never computes. Parsing is exhaustively null-safe: any missing
 * or malformed field degrades to a neutral default rather than crashing the host.
 * Version skew happens in both directions, so every field added after schema 2 is
 * nullable with a hide/neutral default.
 *
 * Shape mirrors `src/features/home/lib/widgetSnapshot.ts` (schema version 14).
 */
private const val SNAPSHOT_FILE = "widget-snapshot.json"

data class Metric(
  val value: Double,
  val trendDir: String,
  /** improved, declined, moved or flat: what the app judged the move to be. */
  val verdict: String = "flat",
  val zone: String? = null,
  val delta: Double? = null,
  /** Form only: the pre-formatted readout, so a percentage setting needs no maths here. */
  val text: String? = null,
) {
  /** What a value slot prints: the engine's text where it sent one, else the rounded number. */
  fun display(): String = text ?: value.roundToInt().toString()
}

/** Normalised 0..1 route outline (y grows downward) of the latest GPS activity. */
data class RoutePreview(val points: List<Pair<Float, Float>>, val aspect: Float)

/** One attempt on the matched route, in date order; the latest is last and the fastest is the record. */
data class AttemptDot(val current: Boolean, val record: Boolean)

/**
 * What the Last activity widget leads with, worded by the engine: `route` for the rank among the
 * attempts and the gap to the record, `load` for the load against the typical one.
 */
data class Headline(
  val kind: String,
  val label: String,
  val hero: String,
  val detail: String?,
  val dots: List<AttemptDot>,
)

data class Latest(
  val activityId: String?,
  val name: String,
  val distanceLabel: String,
  val durationLabel: String,
  val dateLabel: String,
  val tintHex: String,
  val isPr: Boolean,
  val trainingLoad: Int?,
  val routePreview: RoutePreview?,
  /** Null on a snapshot written before the field, or when the app handed the engine no words. */
  val headline: Headline? = null,
  val loadText: String? = null,
  val sectionPrsText: String? = null,
) {
  /**
   * The line under the name: distance and time, then the date on its own line so a long
   * relative date is not cut to fit what the figures leave.
   */
  fun subtitle(): String {
    val figures = listOf(distanceLabel, durationLabel).filter { it.isNotEmpty() }.joinToString(" · ")
    return listOf(figures, dateLabel).filter { it.isNotEmpty() }.joinToString("\n")
  }
}

data class Impact(
  val formBefore: Double,
  val formAfter: Double,
  val beforeText: String?,
  val afterText: String?,
  val beforeZone: String?,
  val afterZone: String?,
  val tssAdded: Int?,
)

data class Weekly(
  val tss: Int,
  val count: Int,
  val deltaPct: Int?,
  val distanceLabel: String,
  val durationLabel: String,
)

/** One pre-formatted summary entry; colorKey names a palette role. */
data class SummaryEntry(
  val id: String,
  val label: String,
  val value: String,
  val trendDir: String,
  val verdict: String = "flat",
  val colorKey: String,
)

/** Ready-to-render mirror of the in-app summary card, following the app settings. */
data class SummaryCard(
  val hero: SummaryEntry,
  val entries: List<SummaryEntry>,
  /** Which snapshot sparkline to draw: "fitnessForm" | "hrv" | "none". */
  val sparkline: String,
  /** The hero's own daily series, oldest first; empty when it has none or the card hides it. */
  val heroSparkline: List<Float> = emptyList(),
)

/**
 * Form per day, oldest first, in the unit the athlete reads it in; a day with no value is null.
 * zoneBounds are where the first four zones end, in the same unit as the values.
 */
data class FormHistory(val values: List<Float?>, val asPercent: Boolean, val zoneBounds: List<Int>)

/** One recent sport: the id a deep link needs and the name a surface shows. */
data class RecordShortcut(val type: String, val label: String, val url: String)

data class WidgetSnapshot(
  val form: Metric,
  val fitness: Metric,
  val fatigue: Metric,
  val hrv: Metric,
  val rhr: Metric,
  val rampRate: Double?,
  val weekly: Weekly,
  val latest: Latest?,
  val impact: Impact?,
  val summaryCard: SummaryCard?,
  val formHistory: FormHistory?,
  val impactLine: String?,
  val metricLabels: Map<String, String>,
  val weekLabel: String,
  val recordLabel: String,
  val refreshLabel: String,
  val refreshingLabel: String,
  val perWeekSuffix: String,
  val formZoneLabel: String?,
  val formSparkline: List<Float>,
  val fitnessSparkline: List<Float>,
  val fatigueSparkline: List<Float>,
  val hrvSparkline: List<Float>,
  /**
   * Seconds since the epoch, when the app wrote this snapshot. Zero on a
   * snapshot written before the field, which reads as "no age to show" rather
   * than as 1970.
   */
  val generatedAt: Long,
  /**
   * True when the library has no activity and no wellness, so the metrics are zeros and not
   * measurements. False on a snapshot written before schema 8.
   */
  val emptyLibrary: Boolean,
  /**
   * Every recent sport, most recent first, pre-localised. The widget picker lists
   * all of them. Empty on a snapshot written before schema 6, or before anything
   * was recorded.
   */
  val recordShortcuts: List<RecordShortcut>,
  /**
   * The head of `recordShortcuts`, capped at what a launcher shows. Single-sport
   * surfaces start its first entry; empty sends them to the picker instead.
   */
  val launcherShortcuts: List<RecordShortcut>,
  /**
   * The small label every widget draws when the numbers come from the sample
   * library, in demo mode and while nobody is signed in. Null on a real library
   * and on a snapshot written before the field.
   */
  val demoLabel: String? = null,
  /**
   * The Insights tab's ranked list, in its order and of every kind. Empty on a snapshot written
   * before schema 11, with no account, or when the ranking could not run.
   */
  val insights: List<WidgetInsight> = emptyList(),
) {
  /** The one a single-sport surface starts. */
  val lastRecordingType: String?
    get() = launcherShortcuts.firstOrNull()?.type

  companion object {
    /** A widget with no snapshot yet, or over an empty library, shows the prompt and no metric. */
    fun showsEmptyPrompt(snap: WidgetSnapshot?): Boolean = snap == null || snap.emptyLibrary

    fun read(context: Context): WidgetSnapshot? {
      return try {
        val file = File(context.filesDir, SNAPSHOT_FILE)
        if (!file.exists()) return null
        parse(JSONObject(file.readText()))
      } catch (_: Exception) {
        null
      }
    }

    internal fun parse(root: JSONObject): WidgetSnapshot {
      val metrics = root.optJSONObject("metrics") ?: JSONObject()
      val weeklyObj = root.optJSONObject("weekly") ?: JSONObject()
      val display = root.optJSONObject("display") ?: JSONObject()
      val labels = display.optJSONObject("metricLabels") ?: JSONObject()
      val sparklines = root.optJSONObject("sparklines")

      return WidgetSnapshot(
        generatedAt = root.optLong("generatedAt", 0L),
        emptyLibrary = root.optBoolean("emptyLibrary", false),
        form = metric(metrics, "form"),
        fitness = metric(metrics, "fitness"),
        fatigue = metric(metrics, "fatigue"),
        hrv = metric(metrics, "hrv"),
        rhr = metric(metrics, "rhr"),
        rampRate = metrics.optJSONObject("rampRate")?.optDouble("value")?.takeIf { !it.isNaN() },
        weekly =
          Weekly(
            tss = weeklyObj.optInt("tss", 0),
            count = weeklyObj.optInt("count", 0),
            deltaPct = if (weeklyObj.isNull("deltaPct")) null else weeklyObj.optInt("deltaPct"),
            distanceLabel = weeklyObj.optString("distanceLabel", ""),
            durationLabel = weeklyObj.optString("durationLabel", ""),
          ),
        latest = parseLatest(root),
        impact = parseImpact(root),
        summaryCard = parseSummaryCard(root),
        formHistory = parseFormHistory(root),
        impactLine = if (display.isNull("impactLine")) null else display.optString("impactLine"),
        metricLabels =
          mapOf(
            "form" to labels.optString("form", "Form"),
            "fitness" to labels.optString("fitness", "Fitness"),
            "fatigue" to labels.optString("fatigue", "Fatigue"),
            "hrv" to labels.optString("hrv", "HRV"),
            "rhr" to labels.optString("rhr", "RHR"),
            "ramp" to labels.optString("ramp", "Ramp"),
          ),
        weekLabel = display.optString("weekLabel", "Week"),
        recordLabel = display.optString("recordLabel", "Record"),
        refreshLabel = display.optString("refreshLabel", "Refresh"),
        refreshingLabel = display.optString("refreshingLabel", "Refreshing"),
        perWeekSuffix = display.optString("perWeekSuffix", "/wk"),
        formZoneLabel = display.optString("formZone", "").takeIf { it.isNotEmpty() },
        formSparkline = floatArray(sparklines?.optJSONArray("form")),
        fitnessSparkline = floatArray(sparklines?.optJSONArray("fitness")),
        fatigueSparkline = floatArray(sparklines?.optJSONArray("fatigue")),
        hrvSparkline = floatArray(sparklines?.optJSONArray("hrv")),
        recordShortcuts = parseShortcuts(root, "recordShortcuts"),
        launcherShortcuts = parseShortcuts(root, "launcherShortcuts"),
        demoLabel = display.optString("demoLabel", "").takeIf { it.isNotEmpty() },
        insights = parseInsights(root),
      )
    }

    private fun parseInsights(root: JSONObject): List<WidgetInsight> {
      val arr = root.optJSONArray("insights") ?: return emptyList()
      val out = ArrayList<WidgetInsight>(arr.length())
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val title = o.optString("title", "")
        val url = o.optString("url", "")
        if (title.isEmpty() || url.isEmpty()) continue
        out.add(
          WidgetInsight(
            id = o.optString("id", ""),
            category = o.optString("category", ""),
            title = title,
            subtitle = o.optString("subtitle", ""),
            icon = o.optString("icon", ""),
            tone = o.optString("tone", "info"),
            url = url,
          ))
      }
      return out
    }

    private fun parseShortcuts(root: JSONObject, key: String): List<RecordShortcut> {
      val arr = root.optJSONArray(key) ?: return emptyList()
      val out = ArrayList<RecordShortcut>(arr.length())
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val type = o.optString("type", "")
        val url = o.optString("url", "")
        if (type.isEmpty() || url.isEmpty()) continue
        out.add(RecordShortcut(type, o.optString("label", "").ifEmpty { type }, url))
      }
      return out
    }

    private fun metric(parent: JSONObject, key: String): Metric {
      val o = parent.optJSONObject(key) ?: return Metric(0.0, "flat")
      return Metric(
        value = o.optDouble("value", 0.0),
        trendDir = o.optString("trendDir", "flat"),
        verdict = o.optString("verdict", "flat"),
        zone = o.optString("zone", "").takeIf { it.isNotEmpty() },
        delta = o.optDouble("deltaVsYesterday").takeIf { !it.isNaN() },
        text = o.optString("text", "").takeIf { it.isNotEmpty() },
      )
    }

    private fun parseLatest(root: JSONObject): Latest? {
      if (root.isNull("latest")) return null
      val l = root.optJSONObject("latest") ?: return null
      return Latest(
        activityId = l.optString("activityId", "").takeIf { it.isNotEmpty() },
        name = l.optString("name", ""),
        distanceLabel = l.optString("distanceLabel", ""),
        durationLabel = l.optString("durationLabel", ""),
        dateLabel = l.optString("dateLabel", ""),
        tintHex = l.optString("tintHex", ""),
        isPr = l.optBoolean("isPr", false),
        trainingLoad = if (l.isNull("trainingLoad")) null else l.optInt("trainingLoad"),
        routePreview = parseRoutePreview(l),
        headline = parseHeadline(l),
        loadText = l.optString("loadText", "").takeIf { it.isNotEmpty() },
        sectionPrsText = l.optString("sectionPrsText", "").takeIf { it.isNotEmpty() },
      )
    }

    private fun parseHeadline(latest: JSONObject): Headline? {
      val h = latest.optJSONObject("headline") ?: return null
      val hero = h.optString("hero", "")
      if (hero.isEmpty()) return null
      val dotsArr = h.optJSONArray("dots")
      val dots = ArrayList<AttemptDot>()
      if (dotsArr != null) {
        for (i in 0 until dotsArr.length()) {
          val d = dotsArr.optJSONObject(i) ?: continue
          dots.add(AttemptDot(current = d.optBoolean("current", false), record = d.optBoolean("record", false)))
        }
      }
      return Headline(
        kind = h.optString("kind", ""),
        label = h.optString("label", ""),
        hero = hero,
        detail = h.optString("detail", "").takeIf { it.isNotEmpty() },
        dots = dots,
      )
    }

    private fun parseRoutePreview(latest: JSONObject): RoutePreview? {
      val p = latest.optJSONObject("routePreview") ?: return null
      val arr = p.optJSONArray("points") ?: return null
      val points = ArrayList<Pair<Float, Float>>(arr.length())
      for (i in 0 until arr.length()) {
        val pair = arr.optJSONArray(i) ?: continue
        val x = pair.optDouble(0, Double.NaN)
        val y = pair.optDouble(1, Double.NaN)
        if (!x.isNaN() && !y.isNaN()) points.add(Pair(x.toFloat(), y.toFloat()))
      }
      if (points.size < 2) return null
      val aspect = p.optDouble("aspect", 1.0)
      return RoutePreview(points, if (aspect.isNaN() || aspect <= 0) 1f else aspect.toFloat())
    }

    private fun parseImpact(root: JSONObject): Impact? {
      if (root.isNull("impact")) return null
      val i = root.optJSONObject("impact") ?: return null
      val before = i.optDouble("formBefore")
      val after = i.optDouble("formAfter")
      if (before.isNaN() || after.isNaN()) return null
      return Impact(
        formBefore = before,
        formAfter = after,
        beforeText = i.optString("formBeforeText", "").takeIf { it.isNotEmpty() },
        afterText = i.optString("formAfterText", "").takeIf { it.isNotEmpty() },
        beforeZone = i.optString("formBeforeZone", "").takeIf { it.isNotEmpty() },
        afterZone = i.optString("formAfterZone", "").takeIf { it.isNotEmpty() },
        tssAdded = if (i.isNull("tssAdded")) null else i.optInt("tssAdded"),
      )
    }

    private fun parseSummaryCard(root: JSONObject): SummaryCard? {
      if (root.isNull("summaryCard")) return null
      val s = root.optJSONObject("summaryCard") ?: return null
      val hero = parseSummaryEntry(s.optJSONObject("hero")) ?: return null
      val entriesArr = s.optJSONArray("entries")
      val entries = ArrayList<SummaryEntry>()
      if (entriesArr != null) {
        for (i in 0 until entriesArr.length()) {
          parseSummaryEntry(entriesArr.optJSONObject(i))?.let { entries.add(it) }
        }
      }
      return SummaryCard(
        hero = hero,
        entries = entries,
        sparkline = s.optString("sparkline", "none"),
        heroSparkline = floatArray(s.optJSONArray("heroSparkline")),
      )
    }

    private fun parseFormHistory(root: JSONObject): FormHistory? {
      val h = root.optJSONObject("formHistory") ?: return null
      val values = h.optJSONArray("values") ?: return null
      val bounds = h.optJSONArray("zoneBounds") ?: return null
      if (bounds.length() != 4) return null
      return FormHistory(
        values =
          List(values.length()) { i ->
            if (values.isNull(i)) null else values.optDouble(i, Double.NaN).takeIf { !it.isNaN() }?.toFloat()
          },
        asPercent = h.optBoolean("asPercent", false),
        zoneBounds = List(4) { i -> bounds.optInt(i) },
      )
    }

    private fun parseSummaryEntry(o: JSONObject?): SummaryEntry? {
      if (o == null) return null
      val label = o.optString("label", "")
      if (label.isEmpty()) return null
      return SummaryEntry(
        id = o.optString("id", ""),
        label = label,
        value = o.optString("value", "-"),
        trendDir = o.optString("trendDir", "flat"),
        verdict = o.optString("verdict", "flat"),
        colorKey = o.optString("colorKey", "default"),
      )
    }

    private fun stringArray(arr: JSONArray?): List<String> {
      if (arr == null) return emptyList()
      val out = ArrayList<String>(arr.length())
      for (i in 0 until arr.length()) {
        val v = arr.optString(i, "")
        if (v.isNotEmpty()) out.add(v)
      }
      return out
    }

    private fun floatArray(arr: JSONArray?): List<Float> {
      if (arr == null) return emptyList()
      val out = ArrayList<Float>(arr.length())
      for (i in 0 until arr.length()) {
        val v = arr.optDouble(i, Double.NaN)
        if (!v.isNaN()) out.add(v.toFloat())
      }
      return out
    }
  }
}
