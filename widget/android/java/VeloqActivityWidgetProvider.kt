package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle

/**
 * Latest Activity widget: the most recent activity's route outline (drawn natively
 * from the snapshot's normalised points) with its headline stats. The whole widget
 * deep-links into the activity detail screen.
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
    manager.updateAppWidget(id, WidgetRenderer.renderActivity(context, snap, w))
  }
}
