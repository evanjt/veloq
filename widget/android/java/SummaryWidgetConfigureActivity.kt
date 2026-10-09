package __PKG__.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import __PKG__.R

/**
 * The picker a placed Summary widget opens, the summary card's own: a hero among the card's
 * heroes, whether the sparkline shows, and up to four supporting metrics in the order they are
 * ticked. Every choice and its rows come from the snapshot, so the widget offers what the card
 * offers and names each metric as the snapshot names it. "Summary Card" in a section, or no
 * supporting metric ticked, follows the card.
 *
 * Configuration is optional in the provider info, so an athlete who dismisses this keeps a widget
 * that follows the app's card, and a reconfigured one keeps what it had.
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

    setTitle(R.string.widget_summary_label)
    setContentView(R.layout.widget_summary_placement_configure)
    val current = SummaryWidgetChoice.placementFor(this, widgetId)
    val followCard = getString(R.string.widget_summary_follow_card)

    val heroes = listOf<String?>(null) + SummaryWidget.heroChoices(snap).map { it.id }
    val heroLabels = listOf(followCard) + SummaryWidget.heroChoices(snap).map { it.label }
    val heroGroup = findViewById<RadioGroup>(R.id.summary_configure_hero)
    addRadios(heroGroup, heroLabels, heroes.indexOf(current.hero).coerceAtLeast(0))

    val sparklines = listOf(null, true, false)
    val sparklineGroup = findViewById<RadioGroup>(R.id.summary_configure_sparkline)
    addRadios(
      sparklineGroup,
      listOf(
        followCard,
        getString(R.string.widget_summary_on),
        getString(R.string.widget_summary_off),
      ),
      sparklines.indexOf(current.sparkline),
    )

    val choices = SummaryWidget.supportingChoices(snap)
    val ticked = current.supporting.filter { id -> choices.any { it.id == id } }.toMutableList()
    val list = findViewById<LinearLayout>(R.id.summary_configure_supporting)
    if (choices.isEmpty()) {
      findViewById<View>(R.id.summary_configure_supporting_title).visibility = View.GONE
    }
    val boxes =
      choices.map { choice ->
        CheckBox(this).apply {
          text = choice.label
          isChecked = choice.id in ticked
          list.addView(this)
        }
      }
    fun holdToMax() {
      val full = ticked.size >= SummaryWidget.SUPPORTING_MAX
      boxes.forEach { it.isEnabled = it.isChecked || !full }
    }
    boxes.forEachIndexed { i, box ->
      box.setOnCheckedChangeListener { _, checked ->
        val id = choices[i].id
        if (checked) {
          if (id !in ticked) ticked.add(id)
        } else {
          ticked.remove(id)
        }
        holdToMax()
      }
    }
    holdToMax()

    findViewById<Button>(R.id.summary_configure_save).setOnClickListener {
      SummaryWidgetChoice.put(
        this,
        widgetId,
        SummaryPlacement(
          hero = heroes[checkedIndex(heroGroup)],
          sparkline = sparklines[checkedIndex(sparklineGroup)],
          supporting = ticked.toList(),
        ),
      )
      commit(widgetId)
    }
  }

  private fun addRadios(group: RadioGroup, labels: List<String>, checked: Int) {
    labels.forEach { label ->
      group.addView(
        RadioButton(this).apply {
          id = View.generateViewId()
          text = label
        })
    }
    group.check(group.getChildAt(checked).id)
  }

  private fun checkedIndex(group: RadioGroup): Int =
    group.indexOfChild(group.findViewById(group.checkedRadioButtonId)).coerceAtLeast(0)

  /** Redraw the widget under its new choice, then hand the id back to the host. */
  private fun commit(widgetId: Int) {
    VeloqWidgetProvider()
      .onUpdate(this, AppWidgetManager.getInstance(this), intArrayOf(widgetId))
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }
}
