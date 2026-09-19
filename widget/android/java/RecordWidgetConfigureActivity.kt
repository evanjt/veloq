package __PKG__.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import __PKG__.R

/**
 * The picker a placed Record widget opens: one row per sport this athlete
 * records, named as the app names it.
 *
 * A provider per sport was the alternative and there is no set to declare one
 * from, the sports are whatever has been recorded. The rows come from the
 * snapshot, so no sport list and no display name is written a second time here.
 *
 * Configuration is optional in the provider info, so an athlete who dismisses
 * this keeps a working widget on the last sport recorded.
 */
class RecordWidgetConfigureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(RESULT_CANCELED)

    val widgetId =
      intent?.extras?.getInt(
        AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        ?: AppWidgetManager.INVALID_APPWIDGET_ID
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }

    val shortcuts = WidgetSnapshot.read(this)?.recordShortcuts.orEmpty()
    if (shortcuts.isEmpty()) {
      // Nothing recorded yet, so there is nothing to choose between. The widget
      // keeps the fallback, which is the picker screen in the app.
      commit(widgetId)
      return
    }

    setContentView(R.layout.widget_record_configure)
    val list = findViewById<LinearLayout>(R.id.record_configure_list)
    for (shortcut in shortcuts) {
      val row =
        layoutInflater.inflate(R.layout.widget_record_configure_row, list, false) as TextView
      row.text = shortcut.label
      row.setOnClickListener {
        RecordWidgetChoice.put(this, widgetId, shortcut.url)
        commit(widgetId)
      }
      list.addView(row as View)
    }
  }

  /** Redraw the widget under its new choice, then hand the id back to the host. */
  private fun commit(widgetId: Int) {
    VeloqRecordWidgetProvider()
      .onUpdate(this, AppWidgetManager.getInstance(this), intArrayOf(widgetId))
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }
}
