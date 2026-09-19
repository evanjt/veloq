package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import __PKG__.R

/**
 * Quick-Record widget: a teal button that starts a ride. Everything it draws
 * comes from the generated widget theme resources, and the whole widget is one
 * PendingIntent.
 *
 * Which ride is per instance: the configure activity stores a link against this
 * widget's id, and an instance with none falls back to the last sport recorded,
 * which the snapshot carries. The request code is the widget id, because
 * `FLAG_UPDATE_CURRENT` rewrites the intent behind a request code and a shared
 * one would point every placed widget at whichever redrew last.
 */
class VeloqRecordWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snap = WidgetSnapshot.read(context)
    for (id in ids) {
      val v = RemoteViews(context.packageName, R.layout.widget_record)
      v.setOnClickPendingIntent(
        R.id.record_root,
        WidgetRenderer.recordIntent(context, snap, RecordWidgetChoice.url(context, id), id))
      manager.updateAppWidget(id, v)
    }
  }

  /** A removed widget's choice is nobody's, and ids are reused. */
  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    RecordWidgetChoice.clear(context, appWidgetIds)
  }
}
