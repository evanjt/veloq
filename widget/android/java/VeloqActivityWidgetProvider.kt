package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Last activity widget: how the most recent activity compared (its rank among the attempts at
 * its route, or its load against the typical one), with the route outline drawn natively from the
 * snapshot's normalised points. The whole widget deep-links into the activity detail screen.
 */
class VeloqActivityWidgetProvider : AppWidgetProvider() {
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

  private fun update(
    context: Context,
    manager: AppWidgetManager,
    snap: WidgetSnapshot?,
    id: Int,
  ) {
    val options = manager.getAppWidgetOptions(id)
    val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
    val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)
    manager.updateAppWidget(id, WidgetRenderer.renderActivity(context, snap, w, h))
  }
}
