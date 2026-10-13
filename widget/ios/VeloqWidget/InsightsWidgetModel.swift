import Foundation

// What the Insights widget draws, decided from the snapshot alone. It imports no UI framework, so
// the choices are plain values: how many rows a size lists, which kinds a placement keeps, and how
// many rows the largest size has no room for.
//
// The snapshot carries the Insights tab's list in the tab's order and of every kind. Each placed
// widget filters it for itself, so one snapshot serves every placement.

/// One insight row, as the Insights tab words it and as the app ranked it.
struct WidgetInsight: Codable {
  let id: String?
  /// The tab's category, which a placement's kind pick filters on.
  let category: String?
  let title: String
  let subtitle: String?
  /// The tab's icon name, which the row draws as its glyph.
  let icon: String?
  /// The tab's tone: a verdict rung, `info` or `opportunity`.
  let tone: String?
  /// Where a tap on the row goes.
  let url: String
  /// The tone as a screen reader says it, since the row's glyph names the card and not its tone.
  /// Nil on a snapshot written before schema 16.
  let toneLabel: String?
}

enum InsightsSize {
  case small
  case medium
  case large
}

/// The rows one size draws and how many more the list holds.
struct InsightsContent {
  let rows: [WidgetInsight]
  let more: Int
}

enum InsightsWidgetModel {
  /// The kinds the app ranks, in the order the picker lists them.
  static let kinds = [
    "section_pr", "section_trend", "route", "stale_pr", "fitness_milestone",
    "period_comparison", "strength_progression", "strength_balance", "hrv_trend",
    "efficiency_trend", "section_changed",
  ]

  /// Where a tap on the count of further rows goes: the Insights tab.
  static let tabURL = URL(string: "veloq://insights")!

  static func rowCount(_ size: InsightsSize) -> Int {
    switch size {
    case .small: return 1
    case .medium: return 2
    case .large: return 4
    }
  }

  /// A kind pick as it is kept: nil lists every kind, which is also what an empty pick and one
  /// naming no kind the app ranks mean, since a widget that lists nothing is not a choice.
  static func normalise(_ picked: [String]) -> Set<String>? {
    let known = Set(picked.filter { kinds.contains($0) })
    return known.isEmpty || known.count == kinds.count ? nil : known
  }

  static func content(_ snapshot: WidgetSnapshot?, size: InsightsSize, kinds picked: [String])
    -> InsightsContent
  {
    let keep = normalise(picked)
    let listed = (snapshot?.insights ?? []).filter { insight in
      if insight.title.isEmpty || URL(string: insight.url) == nil || insight.url.isEmpty {
        return false
      }
      guard let keep = keep else { return true }
      return keep.contains(insight.category ?? "")
    }
    let shown = rowCount(size)
    return InsightsContent(
      rows: Array(listed.prefix(shown)),
      more: size == .large ? max(0, listed.count - shown) : 0)
  }
}
