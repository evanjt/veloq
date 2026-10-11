package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import __PKG__.R

/**
 * Quick-Record widget: a button in the recording tone that starts a ride.
 * Everything it draws comes from the generated widget theme resources, and the
 * whole widget is one PendingIntent.
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
      manager.updateAppWidget(id, render(context, snap, RecordWidgetChoice.url(context, id), id))
    }
  }

  /** A removed widget's choice is nobody's, and ids are reused. */
  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    RecordWidgetChoice.clear(context, appWidgetIds)
  }

  companion object {
    /** The button for one placed instance, starting [configured] or, with none, the last sport. */
    fun render(context: Context, snap: WidgetSnapshot?, configured: String?, id: Int): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.widget_record)
      v.setOnClickPendingIntent(
        R.id.record_root, WidgetRenderer.recordIntent(context, snap, configured, id))
      return v
    }
  }
}
