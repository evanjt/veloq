package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.veloq.NativeWidgetRefreshWorker
import com.veloq.WidgetAgeRefreshWorker
import com.veloq.WidgetDataRefreshWorker

/**
 * Home-screen Summary widget. Renders the last snapshot the app wrote to filesDir. It never
 * computes or touches the database; the JS pipeline (gather, write, reload) owns all data, and
 * the VeloqWidget native module broadcasts an update when a fresh snapshot lands. One provider
 * serves all sizes; the renderer picks a layout by cell size.
 *
 * A placed instance's hero, sparkline and supporting row are chosen on the configure screen and
 * kept per widget id by [SummaryWidgetChoice]. The card opens Fitness; its refresh control queues native work.
 *
 * While one is placed, [WidgetAgeRefreshWorker] redraws it every 15 minutes so the age line stays
 * true. It is scheduled on every update as well as on first placement, because a widget placed
 * before the schedule existed gets no first-placement call. The schedule is shared with every
 * other widget that shows an age line, so removing the last Summary widget does not cancel it:
 * the worker cancels itself once no widget of the app is placed.
 *
 * [WidgetDataRefreshWorker] pulls fresh data on a longer timer while an athlete is signed in, and
 * every data widget settles it the same way, including on its last removal.
 */
class VeloqWidgetProvider : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_REFRESH) {
      NativeWidgetRefreshWorker.enqueue(context)
    } else {
      super.onReceive(context, intent)
    }
  }

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

  /** A removed widget's choice is nobody's, and ids are reused. */
  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    SummaryWidgetChoice.forget(context, appWidgetIds)
  }

  /** A launcher restoring widgets gives them new ids, and the choice has to follow. */
  override fun onRestored(context: Context, oldWidgetIds: IntArray, newWidgetIds: IntArray) {
    SummaryWidgetChoice.remap(context, oldWidgetIds, newWidgetIds)
  }

  private fun update(
    context: Context,
    manager: AppWidgetManager,
    snap: WidgetSnapshot?,
    id: Int,
  ) {
    val options = manager.getAppWidgetOptions(id)
    val placement = SummaryWidgetChoice.placementFor(context, id)
    manager.updateAppWidget(
      id,
      WidgetLayouts.build(options, { SummaryWidget.sizeFor(it.widthDp, it.heightDp) }) {
        WidgetRenderer.render(context, snap, it.widthDp, it.heightDp, placement, id)
      })
  }

  companion object {
    const val ACTION_REFRESH = "__PKG__.widget.ACTION_REFRESH"
  }
}
