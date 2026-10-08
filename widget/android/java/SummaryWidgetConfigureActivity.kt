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
 * The picker a placed Summary widget opens: the app's own summary card first, then each metric
 * every snapshot carries as a hero of its own. The rows are named as the snapshot names them, so
 * no metric name is written a second time here.
 *
 * Configuration is optional in the provider info, so an athlete who dismisses this keeps a widget
 * that follows the app's card.
 */
class SummaryWidgetConfigureActivity : Activity() {
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

    val snap = WidgetSnapshot.read(this)
    if (snap == null) {
      // No snapshot means no metric names to offer; the widget follows the card until one lands.
      commit(widgetId)
      return
    }

    setContentView(R.layout.widget_summary_configure)
    findViewById<TextView>(R.id.summary_configure_prompt)
      .setText(R.string.widget_summary_choose)
    val list = findViewById<LinearLayout>(R.id.summary_configure_list)
    addRow(list, getString(R.string.widget_summary_label)) {
      SummaryWidgetChoice.choose(this, widgetId, SummaryWidget.FOLLOW_CARD)
      commit(widgetId)
    }
    for (hero in SummaryWidget.HERO_CHOICES) {
      addRow(list, snap.metricLabels[hero] ?: hero.replaceFirstChar { it.uppercase() }) {
        SummaryWidgetChoice.choose(this, widgetId, hero)
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
    VeloqWidgetProvider()
      .onUpdate(this, AppWidgetManager.getInstance(this), intArrayOf(widgetId))
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }
}
