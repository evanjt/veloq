package __PKG__.widget

import android.content.Context

/**
 * The kinds of insight one placed Insights widget lists, kept per widget id.
 *
 * Nothing stored means every kind, so an athlete who dismisses the picker keeps a widget that
 * lists what the Insights tab does. A pick naming every kind is stored as nothing, which is what
 * [InsightsWidget.normalise] returns for it.
 */
object InsightsWidgetChoice {
  private const val PREFS = "veloq_insights_widget"

  /** The stored kinds, or null when the widget lists every kind. */
  fun kinds(context: Context, widgetId: Int): Set<String>? =
    prefs(context).getStringSet(key(widgetId), null)?.let { InsightsWidget.normalise(it) }

  fun put(context: Context, widgetId: Int, picked: Collection<String>) {
    val kinds = InsightsWidget.normalise(picked)
    val editor = prefs(context).edit()
    if (kinds == null) editor.remove(key(widgetId)) else editor.putStringSet(key(widgetId), kinds)
    editor.apply()
  }

  /** A removed widget's choice is nobody's, and ids are reused. */
  fun forget(context: Context, widgetIds: IntArray) {
    val editor = prefs(context).edit()
    for (id in widgetIds) editor.remove(key(id))
    editor.apply()
  }

  /** A restored widget keeps its kinds under its new id. */
  fun remap(context: Context, oldIds: IntArray, newIds: IntArray) {
    WidgetIdRemap.rewrite(prefs(context), listOf(PREFIX), oldIds, newIds)
  }

  private const val PREFIX = "kinds_"

  private fun key(widgetId: Int) = "$PREFIX$widgetId"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
