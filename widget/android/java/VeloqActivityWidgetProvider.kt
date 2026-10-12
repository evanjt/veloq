package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import com.veloq.WidgetDataRefreshWorker

/**
 * Last activity widget: how the most recent activity compared (its rank among the attempts at
 * its route, or its load against the typical one), with the route outline drawn natively from the
 * snapshot's normalised points. The whole widget deep-links into the activity detail screen.
 */
class VeloqActivityWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snap = WidgetSnapshot.read(context)
    for (id in ids) update(context, manager, snap, id)
    WidgetDataRefreshWorker.widgetPlaced(context)
  }

  override fun onEnabled(context: Context) {
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
      WidgetLayouts.build(options, { LastActivityWidget.sizeFor(it.widthDp, it.heightDp) }) {
        WidgetRenderer.renderActivity(context, snap, it.widthDp, it.heightDp)
      })
  }
}
