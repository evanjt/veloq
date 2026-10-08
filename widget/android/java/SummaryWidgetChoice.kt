package __PKG__.widget

import android.content.Context

/**
 * The hero one placed Summary widget was configured with, kept per widget id.
 *
 * Nothing stored means the widget follows the app's summary card, so an athlete who dismisses
 * the picker, and every widget placed before it existed, keeps the card's own choice.
 */
object SummaryWidgetChoice {
  private const val PREFS = "veloq_summary_widget"

  /** The stored hero key, or null when the widget follows the card. */
  fun heroFor(context: Context, widgetId: Int): String? {
    val stored = prefs(context).getString(key(widgetId), null)
    return stored?.takeIf { it in SummaryWidget.HERO_CHOICES }
  }

  /** Choosing the card's own entry clears the key, so following the card is the absence of a choice. */
  fun choose(context: Context, widgetId: Int, hero: String) {
    val editor = prefs(context).edit()
    if (hero in SummaryWidget.HERO_CHOICES) {
      editor.putString(key(widgetId), hero)
    } else {
      editor.remove(key(widgetId))
    }
    editor.apply()
  }

  fun forget(context: Context, widgetIds: IntArray) {
    val editor = prefs(context).edit()
    for (id in widgetIds) editor.remove(key(id))
    editor.apply()
  }

  private fun key(widgetId: Int) = "hero_$widgetId"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
