package __PKG__.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The pre-computed, pre-formatted snapshot the JS side writes to filesDir. The widget
 * only renders this, it never computes. Parsing is exhaustively null-safe: any missing
 * or malformed field degrades to a neutral default rather than crashing the host.
 * Version skew happens in both directions, so every field added after schema 2 is
 * nullable with a hide/neutral default.
 *
 * Shape mirrors `src/features/home/lib/widgetSnapshot.ts` (schema version 4).
 */
private const val SNAPSHOT_FILE = "widget-snapshot.json"

data class Metric(
  val value: Double,
  val trendDir: String,
  val zone: String? = null,
  val delta: Double? = null,
)

/** Normalised 0..1 route outline (y grows downward) of the latest GPS activity. */
data class RoutePreview(val points: List<Pair<Float, Float>>, val aspect: Float)

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
)

data class Impact(
  val formBefore: Double,
  val formAfter: Double,
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
  val colorKey: String,
)

/** Ready-to-render mirror of the in-app summary card, following the app settings. */
data class SummaryCard(
  val hero: SummaryEntry,
  val entries: List<SummaryEntry>,
  /** Which snapshot sparkline to draw: "fitnessForm" | "hrv" | "none". */
  val sparkline: String,
)

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
  val impactLine: String?,
  val metricLabels: Map<String, String>,
  val weekLabel: String,
  val formZoneLabel: String?,
  val formSparkline: List<Float>,
  val fitnessSparkline: List<Float>,
  val fatigueSparkline: List<Float>,
  val hrvSparkline: List<Float>,
  /** TSB zone enum per form point (oldest-first); empty on older snapshots. */
  val formZones: List<String>,
) {
  companion object {
    fun read(context: Context): WidgetSnapshot? {
      return try {
        val file = File(context.filesDir, SNAPSHOT_FILE)
        if (!file.exists()) return null
        parse(JSONObject(file.readText()))
      } catch (_: Exception) {
        null
      }
    }

    private fun parse(root: JSONObject): WidgetSnapshot {
      val metrics = root.optJSONObject("metrics") ?: JSONObject()
      val weeklyObj = root.optJSONObject("weekly") ?: JSONObject()
      val display = root.optJSONObject("display") ?: JSONObject()
      val labels = display.optJSONObject("metricLabels") ?: JSONObject()
      val sparklines = root.optJSONObject("sparklines")

      return WidgetSnapshot(
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
        formZoneLabel = display.optString("formZone", "").takeIf { it.isNotEmpty() },
        formSparkline = floatArray(sparklines?.optJSONArray("form")),
        fitnessSparkline = floatArray(sparklines?.optJSONArray("fitness")),
        fatigueSparkline = floatArray(sparklines?.optJSONArray("fatigue")),
        hrvSparkline = floatArray(sparklines?.optJSONArray("hrv")),
        formZones = stringArray(sparklines?.optJSONArray("formZones")),
      )
    }

    private fun metric(parent: JSONObject, key: String): Metric {
      val o = parent.optJSONObject(key) ?: return Metric(0.0, "flat")
      return Metric(
        value = o.optDouble("value", 0.0),
        trendDir = o.optString("trendDir", "flat"),
        zone = o.optString("zone", "").takeIf { it.isNotEmpty() },
        delta = o.optDouble("deltaVsYesterday").takeIf { !it.isNaN() },
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
