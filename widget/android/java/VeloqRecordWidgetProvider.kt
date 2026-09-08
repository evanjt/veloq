package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import __PKG__.R

/**
 * Quick-Record widget: a static teal button that starts the ride. Everything it
 * draws comes from the generated widget theme resources, and the whole widget is
 * one PendingIntent. The snapshot is read for one field, the last recorded sport,
 * which decides whether that intent starts a ride or opens the picker.
 */
class VeloqRecordWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snap = WidgetSnapshot.read(context)
    for (id in ids) {
      val v = RemoteViews(context.packageName, R.layout.widget_record)
      v.setOnClickPendingIntent(R.id.record_root, WidgetRenderer.recordIntent(context, snap))
      manager.updateAppWidget(id, v)
    }
  }
}
