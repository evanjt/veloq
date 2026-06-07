package __PKG__.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The pre-computed, pre-formatted snapshot the JS side writes to filesDir. The widget
 * only renders this — it never computes. Parsing is exhaustively null-safe: any missing
 * or malformed field degrades to a neutral default rather than crashing the host.
 *
 * Shape mirrors `src/features/home/lib/widgetSnapshot.ts` (schema version 2).
 */
private const val SNAPSHOT_FILE = "widget-snapshot.json"

data class Metric(val value: Double, val trendDir: String)

data class Latest(
  val name: String,
  val distanceLabel: String,
  val durationLabel: String,
  val dateLabel: String,
  val tintHex: String,
)

data class Weekly(
  val tss: Int,
  val count: Int,
  val deltaPct: Int?,
  val distanceLabel: String,
  val durationLabel: String,
)

data class WidgetSnapshot(
  val form: Metric,
  val fitness: Metric,
  val fatigue: Metric,
  val weekly: Weekly,
  val latest: Latest?,
  val impactLine: String?,
  val metricLabels: Map<String, String>,
  val weekLabel: String,
  val fitnessSparkline: List<Float>,
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

      return WidgetSnapshot(
        form = metric(metrics, "form"),
        fitness = metric(metrics, "fitness"),
        fatigue = metric(metrics, "fatigue"),
        weekly =
          Weekly(
            tss = weeklyObj.optInt("tss", 0),
            count = weeklyObj.optInt("count", 0),
            deltaPct = if (weeklyObj.isNull("deltaPct")) null else weeklyObj.optInt("deltaPct"),
            distanceLabel = weeklyObj.optString("distanceLabel", ""),
            durationLabel = weeklyObj.optString("durationLabel", ""),
          ),
        latest = parseLatest(root),
        impactLine = if (display.isNull("impactLine")) null else display.optString("impactLine"),
        metricLabels =
          mapOf(
            "form" to labels.optString("form", "Form"),
            "fitness" to labels.optString("fitness", "Fitness"),
            "fatigue" to labels.optString("fatigue", "Fatigue"),
            "hrv" to labels.optString("hrv", "HRV"),
            "rhr" to labels.optString("rhr", "RHR"),
          ),
        weekLabel = display.optString("weekLabel", "Week"),
        fitnessSparkline = floatArray(root.optJSONObject("sparklines")?.optJSONArray("fitness")),
      )
    }

    private fun metric(parent: JSONObject, key: String): Metric {
      val o = parent.optJSONObject(key) ?: return Metric(0.0, "flat")
      return Metric(o.optDouble("value", 0.0), o.optString("trendDir", "flat"))
    }

    private fun parseLatest(root: JSONObject): Latest? {
      if (root.isNull("latest")) return null
      val l = root.optJSONObject("latest") ?: return null
      return Latest(
        name = l.optString("name", ""),
        distanceLabel = l.optString("distanceLabel", ""),
        durationLabel = l.optString("durationLabel", ""),
        dateLabel = l.optString("dateLabel", ""),
        tintHex = l.optString("tintHex", ""),
      )
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
