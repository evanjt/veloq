import Foundation

// What the Last activity widget draws, decided from the snapshot alone. It imports no UI
// framework, so the choices are plain values: which lines a size has room for and which a
// snapshot can fill.
//
// The engine words every line, so nothing here is translated or computed: the comparison the
// activity raised leads, then the section records it set, then the load and form it moved.

enum LastActivitySize {
  case small
  case medium
}

/// The form change an activity made, as the engine worded it, with the zone each side sits in.
struct LastActivityForm {
  let label: String
  let before: String
  let after: String
  let beforeZone: String?
  let afterZone: String?
}

/// One attempt dot: an earlier attempt, the record, or the latest (which may be the record too).
struct LastActivityDot {
  let current: Bool
  let record: Bool
}

/// What the widget draws at one size. A nil field is not drawn, so a size with no room for a line
/// and a snapshot with nothing for it look alike to the view.
struct LastActivityContent {
  /// The activity's name; nil where the comparison takes its place.
  let name: String?
  let showsRoute: Bool
  /// The route's name, or the word for load, above the hero.
  let heroLabel: String?
  let hero: String?
  let detail: String?
  let dots: [LastActivityDot]
  /// Distance and time, drawn only when the snapshot has no comparison to lead with.
  let figures: String?
  let sectionPrs: String?
  let load: String?
  let form: LastActivityForm?
  let date: String?
}

enum LastActivityWidgetModel {
  static func content(_ snapshot: WidgetSnapshot?, size: LastActivitySize) -> LastActivityContent? {
    guard let snapshot = snapshot, let latest = snapshot.latest else { return nil }
    let headline = latest.headline.flatMap { $0.hero.isEmpty ? nil : $0 }
    let small = size == .small
    return LastActivityContent(
      name: small && headline != nil ? nil : latest.name,
      showsRoute: !small && (latest.routePreview?.points.count ?? 0) >= 2,
      heroLabel: nonEmpty(headline?.label),
      hero: headline?.hero,
      detail: nonEmpty(headline?.detail),
      dots: (headline?.dots ?? []).map {
        LastActivityDot(current: $0.current ?? false, record: $0.record ?? false)
      },
      figures: headline == nil
        ? nonEmpty(
          [latest.distanceLabel, latest.durationLabel].filter { !$0.isEmpty }.joined(
            separator: " · "))
        : nil,
      sectionPrs: nonEmpty(latest.sectionPrsText),
      // The load is the hero when there is no ranking, so it is not said twice.
      load: small || headline?.kind == "load" ? nil : nonEmpty(latest.loadText),
      form: small ? nil : formChange(snapshot),
      date: small || headline == nil ? nonEmpty(latest.dateLabel) : nil)
  }

  private static func formChange(_ snapshot: WidgetSnapshot) -> LastActivityForm? {
    guard let impact = snapshot.impact,
      let before = impact.formBeforeText, let after = impact.formAfterText
    else { return nil }
    return LastActivityForm(
      label: snapshot.display.metricLabels.form, before: before, after: after,
      beforeZone: impact.formBeforeZone, afterZone: impact.formAfterZone)
  }

  private static func nonEmpty(_ text: String?) -> String? {
    guard let text = text, !text.isEmpty else { return nil }
    return text
  }
}
