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
  var name: String?
  let showsRoute: Bool
  /// The route's name, or the word for load, above the hero.
  var heroLabel: String?
  let hero: String?
  let detail: String?
  let dots: [LastActivityDot]
  /// Distance and time, drawn only when the snapshot has no comparison to lead with.
  let figures: String?
  var sectionPrs: String?
  var load: String?
  var form: LastActivityForm?
  var date: String?
}

enum LastActivityWidgetModel {
  static func content(_ snapshot: WidgetSnapshot?, size: LastActivitySize) -> LastActivityContent? {
    guard let snapshot = snapshot, let latest = snapshot.latest else { return nil }
    let headline = latest.headline.flatMap { $0.hero.isEmpty ? nil : $0 }
    let small = size == .small
    let name = small && headline != nil ? nil : latest.name
    return LastActivityContent(
      name: name,
      showsRoute: !small && (latest.routePreview?.points.count ?? 0) >= 2,
      // A route that carries the activity's own name is not named twice.
      heroLabel: nonEmpty(headline?.label).flatMap { $0 == name ? nil : $0 },
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

  /// The content, then the same with one more line left out each time, for a widget whose words
  /// run too long for its family to show them all whole. Lines go in the reverse of the order
  /// they matter: form, load, date, section records, the label above the hero, then the name
  /// where a comparison leads. The comparison itself, its dots and the figures stay in every one.
  static func fallbacks(_ content: LastActivityContent) -> [LastActivityContent] {
    var shorter = content
    var all = [content]
    func drop<Line>(_ line: WritableKeyPath<LastActivityContent, Line?>) {
      guard shorter[keyPath: line] != nil else { return }
      shorter[keyPath: line] = nil
      all.append(shorter)
    }
    drop(\.form)
    drop(\.load)
    drop(\.date)
    drop(\.sectionPrs)
    drop(\.heroLabel)
    if content.hero != nil { drop(\.name) }
    return all
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
