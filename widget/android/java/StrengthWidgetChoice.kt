package __PKG__.widget

import android.content.Context

/**
 * The window one placed Strength widget draws, kept per widget id.
 *
 * Nothing stored means the last 30 days, so an athlete who dismisses the picker keeps the window
 * the strength tab opens on.
 */
object StrengthWidgetChoice {
  private const val PREFS = "veloq_strength_widget"

  fun windowFor(context: Context, widgetId: Int): String =
    StrengthWidget.normalise(prefs(context).getString(key(widgetId), null))

  /** The default is stored as nothing, so following it is the absence of a choice. */
  fun choose(context: Context, widgetId: Int, window: String) {
    val editor = prefs(context).edit()
    if (StrengthWidget.normalise(window) == StrengthWidget.LAST30) {
      editor.remove(key(widgetId))
    } else {
      editor.putString(key(widgetId), window)
    }
    editor.apply()
  }

  /** A removed widget's choice is nobody's, and ids are reused. */
  fun forget(context: Context, widgetIds: IntArray) {
    val editor = prefs(context).edit()
    for (id in widgetIds) editor.remove(key(id))
    editor.apply()
  }

  /** A restored widget keeps its window under its new id. */
  fun remap(context: Context, oldIds: IntArray, newIds: IntArray) {
    WidgetIdRemap.rewrite(prefs(context), listOf(PREFIX), oldIds, newIds)
  }

  private const val PREFIX = "window_"

  private fun key(widgetId: Int) = "$PREFIX$widgetId"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
