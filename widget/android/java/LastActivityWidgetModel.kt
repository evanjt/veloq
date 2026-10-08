package __PKG__.widget

/** The form change an activity made, as the engine worded it, with the zone each side sits in. */
data class FormChange(
  val label: String,
  val before: String,
  val after: String,
  val beforeZone: String?,
  val afterZone: String?,
)

/**
 * What the Last activity widget draws at one size. A null field is not drawn, so a size that has
 * no room for a line and a snapshot that has nothing for it look alike to the renderer.
 */
data class LastActivityContent(
  /** The activity's name; null where the comparison takes its place. */
  val name: String?,
  val showsRoute: Boolean,
  /** The route's name, or the word for load, above the hero. */
  val heroLabel: String?,
  val hero: String?,
  val detail: String?,
  val dots: List<AttemptDot>,
  /** Distance and time, drawn only when the snapshot has no comparison to lead with. */
  val figures: String?,
  val sectionPrs: String?,
  val load: String?,
  val form: FormChange?,
  val date: String?,
  val isPr: Boolean,
)

/**
 * What the Last activity widget draws, decided from the snapshot alone. It holds no Android type,
 * so the choices run on the JVM: which lines a size has room for and which a snapshot can fill.
 *
 * The engine words every line, so nothing here is translated or computed: the comparison the
 * activity raised leads, then the section records it set, then the load and form it moved.
 */
object LastActivityWidget {
  /** Narrow is Small; a wide one is Medium until it is tall enough for the load and form rows. */
  fun sizeFor(widthDp: Int, heightDp: Int): SummarySize =
    when {
      widthDp < 200 -> SummarySize.SMALL
      heightDp >= 180 -> SummarySize.LARGE
      else -> SummarySize.MEDIUM
    }

  fun content(snap: WidgetSnapshot, size: SummarySize): LastActivityContent? {
    val latest = snap.latest ?: return null
    val headline = latest.headline
    val leads = headline != null
    val small = size == SummarySize.SMALL
    val large = size == SummarySize.LARGE
    return LastActivityContent(
      name = if (small && leads) null else latest.name,
      showsRoute = !small && latest.routePreview != null,
      heroLabel = headline?.label?.takeIf { it.isNotEmpty() },
      hero = headline?.hero,
      detail = headline?.detail,
      dots = headline?.dots ?: emptyList(),
      figures =
        if (leads) null
        else
          listOf(latest.distanceLabel, latest.durationLabel)
            .filter { it.isNotEmpty() }
            .joinToString(" · ")
            .takeIf { it.isNotEmpty() },
      sectionPrs = latest.sectionPrsText,
      // The load is the hero when there is no ranking, so it is not said twice.
      load = if (large && headline?.kind != "load") latest.loadText else null,
      form = if (large) formChange(snap) else null,
      date = if (small || large || !leads) latest.dateLabel.takeIf { it.isNotEmpty() } else null,
      isPr = latest.isPr,
    )
  }

  private fun formChange(snap: WidgetSnapshot): FormChange? {
    val impact = snap.impact ?: return null
    val before = impact.beforeText ?: return null
    val after = impact.afterText ?: return null
    return FormChange(
      label = snap.metricLabels["form"] ?: "Form",
      before = before,
      after = after,
      beforeZone = impact.beforeZone,
      afterZone = impact.afterZone,
    )
  }
}
