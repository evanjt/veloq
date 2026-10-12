package __PKG__.widget

import android.content.Context

/**
 * The placement one Summary widget was configured with, kept per widget id: its hero, its
 * sparkline setting and its supporting row.
 *
 * Nothing stored means the widget follows the app's summary card, so an athlete who dismisses
 * the picker, and every widget placed before it existed, keeps the card's own choice. Whether a
 * stored hero is still one the card offers is the model's to decide, against the snapshot.
 */
object SummaryWidgetChoice {
  private const val PREFS = "veloq_summary_widget"

  fun placementFor(context: Context, widgetId: Int): SummaryPlacement {
    val prefs = prefs(context)
    return SummaryPlacement(
      hero = prefs.getString(heroKey(widgetId), null),
      sparkline =
        when (prefs.getString(sparklineKey(widgetId), null)) {
          "on" -> true
          "off" -> false
          else -> null
        },
      supporting =
        prefs.getString(supportingKey(widgetId), null)
          ?.split(',')
          ?.filter { it.isNotEmpty() }
          .orEmpty(),
    )
  }

  /** Each field left to follow the card is stored as nothing, so following is the absence of a choice. */
  fun put(context: Context, widgetId: Int, placement: SummaryPlacement) {
    val editor = prefs(context).edit()
    val hero = placement.hero
    if (hero == null) editor.remove(heroKey(widgetId)) else editor.putString(heroKey(widgetId), hero)
    when (placement.sparkline) {
      null -> editor.remove(sparklineKey(widgetId))
      true -> editor.putString(sparklineKey(widgetId), "on")
      false -> editor.putString(sparklineKey(widgetId), "off")
    }
    val supporting = placement.supporting.take(SummaryWidget.SUPPORTING_MAX)
    if (supporting.isEmpty()) {
      editor.remove(supportingKey(widgetId))
    } else {
      editor.putString(supportingKey(widgetId), supporting.joinToString(","))
    }
    editor.apply()
  }

  /** A removed widget's choice is nobody's, and ids are reused. */
  fun forget(context: Context, widgetIds: IntArray) {
    val editor = prefs(context).edit()
    for (id in widgetIds) {
      editor.remove(heroKey(id))
      editor.remove(sparklineKey(id))
      editor.remove(supportingKey(id))
    }
    editor.apply()
  }

  /** A restored widget keeps its placement under its new id. */
  fun remap(context: Context, oldIds: IntArray, newIds: IntArray) {
    WidgetIdRemap.rewrite(prefs(context), listOf(HERO, SPARKLINE, SUPPORTING), oldIds, newIds)
  }

  private const val HERO = "hero_"

  private const val SPARKLINE = "sparkline_"

  private const val SUPPORTING = "supporting_"

  private fun heroKey(widgetId: Int) = "$HERO$widgetId"

  private fun sparklineKey(widgetId: Int) = "$SPARKLINE$widgetId"

  private fun supportingKey(widgetId: Int) = "$SUPPORTING$widgetId"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
