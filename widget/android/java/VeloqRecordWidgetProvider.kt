package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import __PKG__.R

/**
 * Quick-Record widget: a static teal button that deep-links into the record screen.
 * No snapshot behind it: everything renders from the generated widget theme
 * resources, and the whole widget is one PendingIntent.
 */
class VeloqRecordWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val v = RemoteViews(context.packageName, R.layout.widget_record)
      v.setOnClickPendingIntent(R.id.record_root, WidgetRenderer.recordIntent(context))
      manager.updateAppWidget(id, v)
    }
  }
}
