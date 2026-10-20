package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import com.veloq.WidgetAgeRefreshWorker
import com.veloq.WidgetDataRefreshWorker

/**
 * Strength widget: the training load of the trailing 30 days drawn on the body, the front on a
 * small placement, front and back on a medium, and both with the most trained muscles on a large.
 * It is placed with nothing to choose.
 *
 * It keeps the age line true the way the Insights widget does: [WidgetAgeRefreshWorker] redraws
 * every placed widget, and is scheduled on every update as well as on first placement.
 */
class VeloqStrengthWidgetProvider : AppWidgetProvider() {
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

  private fun update(
    context: Context,
    manager: AppWidgetManager,
    snap: WidgetSnapshot?,
    id: Int,
  ) {
    val options = manager.getAppWidgetOptions(id)
    manager.updateAppWidget(
      id,
      WidgetLayouts.build(options, { StrengthWidget.sizeFor(it.widthDp, it.heightDp) }) {
        StrengthWidgetRenderer.render(context, snap, it.widthDp, it.heightDp)
      })
  }
}
