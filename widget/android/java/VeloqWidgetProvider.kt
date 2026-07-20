package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * Home-screen dashboard widget. Renders the last snapshot the app wrote to filesDir.
 * It never computes or touches the database; the JS pipeline (gather, write, reload)
 * owns all data, and the VeloqWidget native module broadcasts an update when a fresh
 * snapshot lands. One provider serves all sizes; the renderer picks a layout by cell
 * size.
 *
 * Tapping the hero on Small/Medium fires ACTION_CYCLE_METRIC, which advances that
 * instance's stored hero key (SharedPreferences by appWidgetId) and re-renders it.
 */
class VeloqWidgetProvider : AppWidgetProvider() {
  companion object {
    const val ACTION_CYCLE_METRIC = "__PKG__.widget.CYCLE_METRIC"
    private const val PREFS = "veloq_widget_prefs"
    private const val KEY_PREFIX = "hero_metric_"
    private val CYCLE = listOf("form", "fitness", "fatigue", "hrv", "rhr", "summary")

    fun heroMetricFor(context: Context, widgetId: Int): String {
      val stored =
        context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .getString(KEY_PREFIX + widgetId, null)
      return if (stored != null && stored in CYCLE) stored else CYCLE[0]
    }

    private fun cycleMetric(context: Context, widgetId: Int) {
      val current = heroMetricFor(context, widgetId)
      val next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.size]
      context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_PREFIX + widgetId, next)
        .apply()
    }

    private fun clearMetric(context: Context, widgetId: Int) {
      context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .remove(KEY_PREFIX + widgetId)
        .apply()
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snap = WidgetSnapshot.read(context)
    for (id in ids) update(context, manager, snap, id)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    newOptions: Bundle,
  ) {
    update(context, manager, WidgetSnapshot.read(context), id)
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_CYCLE_METRIC) {
      val id =
        intent.getIntExtra(
          AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
        cycleMetric(context, id)
        update(context, AppWidgetManager.getInstance(context), WidgetSnapshot.read(context), id)
        return
      }
    }
    super.onReceive(context, intent)
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    for (id in ids) clearMetric(context, id)
  }

  private fun update(
    context: Context,
    manager: AppWidgetManager,
    snap: WidgetSnapshot?,
    id: Int,
  ) {
    val options = manager.getAppWidgetOptions(id)
    val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
    val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)
    manager.updateAppWidget(
      id, WidgetRenderer.render(context, snap, w, h, heroMetricFor(context, id), id))
  }
}
