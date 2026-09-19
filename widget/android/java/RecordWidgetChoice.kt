package __PKG__.widget

import android.content.Context

/**
 * The sport one placed Record widget was configured with, kept per widget id.
 *
 * The deep link is stored rather than the sport's type, because the recents list
 * the snapshot is built from caps at four: a sport a widget was configured with
 * drops off it, and a type alone would then match nothing and the widget would
 * quietly start whatever was recorded last. Nothing here composes a URL, the app
 * does that and carries it on the snapshot.
 */
object RecordWidgetChoice {
  private const val PREFS = "veloq_record_widget"

  fun url(context: Context, widgetId: Int): String? = prefs(context).getString(key(widgetId), null)

  fun put(context: Context, widgetId: Int, url: String) {
    prefs(context).edit().putString(key(widgetId), url).apply()
  }

  fun clear(context: Context, widgetIds: IntArray) {
    val editor = prefs(context).edit()
    for (id in widgetIds) editor.remove(key(id))
    editor.apply()
  }

  private fun key(widgetId: Int) = "sport_url_$widgetId"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
