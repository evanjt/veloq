package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import __PKG__.R

/**
 * The picker a placed Strength widget opens: the last 30 days, then the calendar month. The rows
 * are named as the snapshot names the windows, so the month reads as the month it is.
 *
 * Configuration is optional in the provider info, so an athlete who dismisses this keeps a widget
 * on the last 30 days.
 */
class StrengthWidgetConfigureActivity : WidgetConfigureActivity() {
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

    val block = WidgetSnapshot.read(this)?.strength
    if (block == null) {
      // No snapshot means no window names to offer; the widget keeps the default until one lands.
      commit(widgetId)
      return
    }

    showPicker(R.string.widget_strength_label, R.layout.widget_summary_configure)
    findViewById<TextView>(R.id.summary_configure_prompt).setText(R.string.widget_strength_choose)
    val list = findViewById<LinearLayout>(R.id.summary_configure_list)
    for (window in StrengthWidget.WINDOWS) {
      val label = if (window == StrengthWidget.MONTH) block.month.label else block.last30.label
      addRow(list, label) {
        StrengthWidgetChoice.choose(this, widgetId, window)
        commit(widgetId)
      }
    }
  }

  private fun addRow(list: LinearLayout, text: String, onPick: () -> Unit) {
    val row = layoutInflater.inflate(R.layout.widget_record_configure_row, list, false) as TextView
    row.text = text
    row.setOnClickListener { onPick() }
    list.addView(row as View)
  }

  /** Redraw the widget under its new choice, then hand the id back to the host. */
  private fun commit(widgetId: Int) {
    VeloqStrengthWidgetProvider()
      .onUpdate(this, AppWidgetManager.getInstance(this), intArrayOf(widgetId))
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }
}
