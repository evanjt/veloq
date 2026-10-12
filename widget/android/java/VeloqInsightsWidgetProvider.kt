package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import com.veloq.WidgetAgeRefreshWorker
import com.veloq.WidgetDataRefreshWorker

/**
 * Insights widget: the Insights tab's top cards, one on a small placement, two on a medium and
 * four on a large, each opening its own target. Which kinds it lists is chosen once, on the
 * configure screen, and kept per widget id by [InsightsWidgetChoice].
 *
 * It keeps the age line true the way the Summary widget does: [WidgetAgeRefreshWorker] redraws
 * every placed widget, and is scheduled on every update as well as on first placement, because a
 * widget placed before the schedule existed gets no first-placement call. The worker cancels
 * itself once no widget is placed.
 */
class VeloqInsightsWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snap = WidgetSnapshot.read(context)
    for (id in ids) update(context, manager, snap, id)
    WidgetAgeRefreshWorker.schedule(context)
    WidgetDataRefreshWorker.widgetPlaced(context)
  }

  override fun onEnabled(context: Context) {
    WidgetAgeRefreshWorker.schedule(context)
    WidgetDataRefreshWorker.widgetPlaced(context)
  }

  override fun onDisabled(context: Context) {
    WidgetDataRefreshWorker.reconcile(context)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    newOptions: Bundle,
  ) {
    update(context, manager, WidgetSnapshot.read(context), id)
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    InsightsWidgetChoice.forget(context, appWidgetIds)
  }

  /** A launcher restoring widgets gives them new ids, and the choice has to follow. */
  override fun onRestored(context: Context, oldWidgetIds: IntArray, newWidgetIds: IntArray) {
    InsightsWidgetChoice.remap(context, oldWidgetIds, newWidgetIds)
  }

  private fun update(
    context: Context,
    manager: AppWidgetManager,
    snap: WidgetSnapshot?,
    id: Int,
  ) {
    val options = manager.getAppWidgetOptions(id)
    val kinds = InsightsWidgetChoice.kinds(context, id)
    manager.updateAppWidget(
      id,
      WidgetLayouts.build(options, { InsightsWidget.sizeFor(it.widthDp, it.heightDp) }) {
        InsightsWidgetRenderer.render(context, snap, it.widthDp, it.heightDp, kinds, id)
      })
  }
}
