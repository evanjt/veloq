package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.os.Bundle
import com.veloq.WidgetAgeRefreshWorker

/**
 * Strength widget: the training load of one window drawn on the body, the front on a small
 * placement, front and back on a medium, and both with the most trained muscles on a large. Which
 * window it draws is chosen once, on the configure screen, and kept per widget id by
 * [StrengthWidgetChoice].
 *
 * It keeps the age line true the way the Insights widget does: [WidgetAgeRefreshWorker] redraws
 * every placed widget, and is scheduled on every update as well as on first placement.
 */
class VeloqStrengthWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snap = WidgetSnapshot.read(context)
    for (id in ids) update(context, manager, snap, id)
    WidgetAgeRefreshWorker.schedule(context)
  }

  override fun onEnabled(context: Context) {
    WidgetAgeRefreshWorker.schedule(context)
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
    StrengthWidgetChoice.forget(context, appWidgetIds)
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
      id, StrengthWidgetRenderer.render(context, snap, w, h, StrengthWidgetChoice.windowFor(context, id)))
  }
}
