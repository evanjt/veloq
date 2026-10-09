import Foundation

// What the Summary widget draws, decided from the snapshot alone. It imports no UI framework, so
// the choices are plain values: which card a placement shows, which entries each size lists,
// which chart sits beside the hero.
//
// The card is the in-app summary card the snapshot carries. A placement may choose a hero among
// the card's own heroes, a sparkline setting and a supporting row among the metrics the snapshot
// carries; anything it leaves unset follows the card.

/// A tap anywhere on the widget opens the Fitness tab.
enum SummaryDeepLink {
  static let fitness = URL(string: "veloq://fitness")!
}

enum SummarySize {
  case small
  case medium
  case large
}

/// What one placed widget was configured with. Every field unset follows the app's card, so a
/// widget placed before the picker existed, and one whose picker was dismissed, keeps the card.
struct SummaryPlacement: Equatable {
  /// A hero id from the card's list, or nil to follow the card.
  var hero: String?
  /// True shows the hero's chart, false hides it, nil follows the card.
  var sparkline: Bool?
  /// Metric ids in order, at most four. Empty follows the card.
  var supporting: [String]

  init(hero: String? = nil, sparkline: Bool? = nil, supporting: [String] = []) {
    self.hero = hero
    self.sparkline = sparkline
    self.supporting = supporting
  }

  static let followCard = SummaryPlacement()
}

/// What the trend image beside the hero draws.
enum SummaryChartKind: Equatable {
  case none
  /// Fitness and fatigue over one shared domain.
  case fitnessForm
  /// One series with a faint fill.
  case hrv
}

/// One form zone of the large chart: where it starts and ends in the chart's unit.
struct FormBand: Equatable {
  let zone: String
  let from: Double
  let to: Double
}

/// Six weeks of form over its five zones. The bands run from the chart's floor to its ceiling,
/// which hold every value and every zone, so a run of days inside one zone still shows the rest.
struct FormZoneChart: Equatable {
  let values: [Double?]
  let bands: [FormBand]
  let min: Double
  let max: Double
}

struct SummaryContent {
  let hero: WidgetSummaryEntry
  /// The line under the hero's value: the form zone where the hero is form, nil otherwise.
  let heroLine: String?
  let chart: SummaryChartKind
  /// Empty on Small, up to four otherwise.
  let supporting: [WidgetSummaryEntry]
  /// Large only, and only with two measured days and the four zone bounds.
  let formZones: FormZoneChart?
}

enum SummaryWidgetModel {
  static let supportingMax = 4

  /// The metrics every snapshot carries a reading for, whatever its card or metric list holds.
  static let headlineIds = ["form", "fitness", "fatigue", "hrv", "rhr"]

  private static let formZoneOrder = ["highRisk", "optimal", "greyZone", "fresh", "transition"]

  static func content(
    _ snapshot: WidgetSnapshot, placement: SummaryPlacement, size: SummarySize
  ) -> SummaryContent {
    let card = snapshot.summaryCard ?? fallbackCard(snapshot)
    // A hero the card no longer offers, or one a snapshot before the list cannot vouch for,
    // follows the card.
    let offered = snapshot.summaryHeroes ?? []
    let hero =
      placement.hero
      .flatMap { offered.contains($0) && $0 != card.hero.id ? entry(snapshot, card, $0) : nil }
      ?? card.hero

    let supporting: [WidgetSummaryEntry]
    if size == .small {
      supporting = []
    } else if placement.supporting.isEmpty {
      // A different hero takes its place in the card's row, so the card's own hero is not lost.
      supporting = Array(
        ([card.hero] + card.entries).filter { $0.id != hero.id }.prefix(supportingMax))
    } else {
      var seen = Set<String>()
      supporting = Array(
        placement.supporting.filter { seen.insert($0).inserted }
          .compactMap { entry(snapshot, card, $0) }.prefix(supportingMax))
    }

    let shows = placement.sparkline ?? (card.sparkline != "none")
    return SummaryContent(
      hero: hero,
      heroLine: hero.id == "form" ? snapshot.display.formZone : nil,
      chart: shows ? chartKind(snapshot, hero) : .none,
      supporting: supporting,
      formZones: size == .large ? formZones(snapshot) : nil)
  }

  /// A chart the snapshot holds a series for; HRV has its own and every other hero shows the
  /// feed's fitness and form lines, as the card does.
  private static func chartKind(_ snapshot: WidgetSnapshot, _ hero: WidgetSummaryEntry)
    -> SummaryChartKind
  {
    if hero.id == "hrv" {
      return snapshot.sparklines.hrv.count >= 2 ? .hrv : .none
    }
    return snapshot.sparklines.fitness.count >= 2 ? .fitnessForm : .none
  }

  /// A snapshot with no card (disabled in the app, or written before it) still has form and four
  /// metrics.
  private static func fallbackCard(_ snapshot: WidgetSnapshot) -> WidgetSummaryCard {
    WidgetSummaryCard(
      hero: metricEntry(snapshot, "form"),
      entries: ["fitness", "fatigue", "hrv", "rhr"].map { metricEntry(snapshot, $0) },
      sparkline: "fitnessForm")
  }

  /// One metric by id: the snapshot's list of every summary metric first, then what the card
  /// already holds, then the headline metrics every snapshot carries.
  private static func entry(_ snapshot: WidgetSnapshot, _ card: WidgetSummaryCard, _ id: String)
    -> WidgetSummaryEntry?
  {
    if let found = snapshot.summaryMetrics?.first(where: { $0.id == id }) { return found }
    if let found = ([card.hero] + card.entries).first(where: { $0.id == id }) { return found }
    return headlineIds.contains(id) ? metricEntry(snapshot, id) : nil
  }

  private static func metricEntry(_ snapshot: WidgetSnapshot, _ id: String) -> WidgetSummaryEntry {
    let m: SnapshotMetric
    let label: String
    let colorKey: String
    let labels = snapshot.display.metricLabels
    switch id {
    case "form":
      (m, label, colorKey) = (snapshot.metrics.form, labels.form, "formZone")
    case "fitness":
      (m, label, colorKey) = (snapshot.metrics.fitness, labels.fitness, "blue")
    case "fatigue":
      (m, label, colorKey) = (snapshot.metrics.fatigue, labels.fatigue, "fatigue")
    case "hrv":
      (m, label, colorKey) = (snapshot.metrics.hrv, labels.hrv, "default")
    default:
      (m, label, colorKey) = (snapshot.metrics.rhr, labels.rhr, "default")
    }
    return WidgetSummaryEntry(
      id: id, label: label, value: m.text ?? String(Int(m.value.rounded())),
      trendDir: m.trendDir, verdict: m.verdict, colorKey: colorKey)
  }

  /// The large chart, absent without two measured days or without the four zone bounds.
  static func formZones(_ snapshot: WidgetSnapshot) -> FormZoneChart? {
    guard let history = snapshot.formHistory else { return nil }
    let measured = history.values.compactMap { $0 }
    guard measured.count >= 2, history.zoneBounds.count == formZoneOrder.count - 1,
      let lowest = measured.min(), let highest = measured.max(),
      let firstBound = history.zoneBounds.first, let lastBound = history.zoneBounds.last
    else { return nil }

    let bounds = history.zoneBounds
    let low = Swift.min(lowest, firstBound)
    let high = Swift.max(highest, lastBound)
    let pad = Swift.max((high - low) * 0.08, 2)
    let floor = low - pad
    let ceiling = high + pad

    let edges = [floor] + bounds + [ceiling]
    return FormZoneChart(
      values: history.values,
      bands: formZoneOrder.enumerated().map { i, zone in
        FormBand(zone: zone, from: edges[i], to: edges[i + 1])
      },
      min: floor, max: ceiling)
  }
}
