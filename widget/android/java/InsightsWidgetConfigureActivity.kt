package __PKG__.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.material.checkbox.MaterialCheckBox
import __PKG__.R

/**
 * The picker a placed Insights widget opens: one tick per kind of insight the app ranks, all
 * ticked until the athlete unticks some. A pick of no kind or of every kind lists every kind, so
 * there is no way to place a widget that can list nothing.
 *
 * Configuration is optional in the provider info, so an athlete who dismisses this keeps a widget
 * that lists what the Insights tab does.
 */
class InsightsWidgetConfigureActivity : WidgetConfigureActivity() {
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

    showPicker(R.string.widget_insights_label, R.layout.widget_insights_configure)
    findViewById<TextView>(R.id.insights_configure_prompt).setText(R.string.widget_insights_kinds_choose)
    val current = InsightsWidgetChoice.kinds(this, widgetId)
    val list = findViewById<LinearLayout>(R.id.insights_configure_list)
    val boxes =
      InsightsWidget.KINDS.map { kind ->
        MaterialCheckBox(this).apply {
          setText(kindLabel(kind))
          isChecked = current == null || kind in current
          list.addView(this)
        }
      }
    findViewById<View>(R.id.insights_configure_save).setOnClickListener {
      InsightsWidgetChoice.put(
        this, widgetId, InsightsWidget.KINDS.filterIndexed { i, _ -> boxes[i].isChecked })
      commit(widgetId)
    }
  }

  /** The kind's name, from the generated string resources in the athlete's language. */
  private fun kindLabel(kind: String): Int =
    when (kind) {
      "section_pr" -> R.string.widget_insight_kind_section_pr
      "section_trend" -> R.string.widget_insight_kind_section_trend
      "route" -> R.string.widget_insight_kind_route
      "stale_pr" -> R.string.widget_insight_kind_stale_pr
      "fitness_milestone" -> R.string.widget_insight_kind_fitness_milestone
      "period_comparison" -> R.string.widget_insight_kind_period_comparison
      "strength_progression" -> R.string.widget_insight_kind_strength_progression
      "strength_balance" -> R.string.widget_insight_kind_strength_balance
      "hrv_trend" -> R.string.widget_insight_kind_hrv_trend
      "efficiency_trend" -> R.string.widget_insight_kind_efficiency_trend
      else -> R.string.widget_insight_kind_section_changed
    }

  /** Redraw the widget under its new choice, then hand the id back to the host. */
  private fun commit(widgetId: Int) {
    VeloqInsightsWidgetProvider()
      .onUpdate(this, AppWidgetManager.getInstance(this), intArrayOf(widgetId))
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }
}
