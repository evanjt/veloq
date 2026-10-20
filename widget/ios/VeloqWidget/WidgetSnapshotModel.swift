import Foundation

// Decodable mirror of src/features/home/lib/widgetSnapshot.ts (schema version 16). The
// widget only renders this, it never computes. Optional fields decode to nil when the
// key is missing, so a partial or older-schema snapshot degrades gracefully instead of
// failing to decode. Version skew happens in both directions: keep every field added
// after schema 2 optional.

struct SnapshotMetric: Codable {
  let value: Double
  let trendDir: String
  /// "improved", "declined", "moved" or "flat": what the app judged the move to be.
  let verdict: String?
  let deltaVsYesterday: Double?
  /// Form only: TSB zone enum ("highRisk"..."transition"). The widget never derives
  /// zone boundaries itself.
  let zone: String?
  /// Form only: the pre-formatted readout, so a percentage setting needs no maths here.
  let text: String?
  /// The name, the reading and the verdict as a screen reader says them, since the arrow
  /// carries the verdict in colour alone. Nil on a snapshot written before schema 16.
  let spoken: String?
}

struct WidgetRamp: Codable {
  let value: Double
}

struct WidgetMetrics: Codable {
  let form: SnapshotMetric
  let fitness: SnapshotMetric
  let fatigue: SnapshotMetric
  let rampRate: WidgetRamp?
  let hrv: SnapshotMetric
  let rhr: SnapshotMetric
}

struct WidgetSparklines: Codable {
  let form: [Double]
  let fitness: [Double]
  let fatigue: [Double]?
  let hrv: [Double]
}

struct WidgetWeekly: Codable {
  let tss: Double
  let distanceM: Double
  let durationS: Double
  let count: Double
  let deltaPct: Double?
  let distanceLabel: String
  let durationLabel: String
}

/// Normalised 0..1 route outline of the latest GPS activity (y grows downward).
struct WidgetRoutePreview: Codable {
  let points: [[Double]]
  let aspect: Double
}

/// One attempt on the matched route, in date order. The latest is last, the fastest is the record.
struct WidgetAttemptDot: Codable {
  let current: Bool?
  let record: Bool?
}

/// What the Last activity widget leads with, worded by the engine: `route` for the rank among the
/// attempts and the gap to the record, `load` for the load against the typical one.
struct WidgetHeadline: Codable {
  let kind: String?
  let label: String?
  let hero: String
  let detail: String?
  let dots: [WidgetAttemptDot]?
}

struct WidgetLatest: Codable {
  let activityId: String?
  let name: String
  let sportType: String
  let distanceLabel: String
  let durationLabel: String
  let dateLabel: String
  let trainingLoad: Double?
  let tintHex: String
  let isPr: Bool?
  let routePreview: WidgetRoutePreview?
  /// Nil in a snapshot written before schema 14, or when the app handed the engine no words.
  let headline: WidgetHeadline?
  /// "Load 62", already worded; nil without a recorded load.
  let loadText: String?
  /// "Section PRs 3", already worded; nil when the activity holds none.
  let sectionPrsText: String?
  /// What the drawn route is, as a screen reader says it. Nil with no route drawn.
  let routeLabel: String?
  /// What the record mark beside the name says. Nil when no record was set.
  let prLabel: String?
}

struct WidgetImpact: Codable {
  let formBefore: Double
  let formAfter: Double
  let formBeforeText: String?
  let formAfterText: String?
  let formBeforeZone: String?
  let formAfterZone: String?
  /// The zones in words; nil in a snapshot written before the engine named them.
  let formBeforeZoneText: String?
  let formAfterZoneText: String?
  let ctlDelta: Double
  let atlDelta: Double
  let tssAdded: Double?
  let dateLabel: String
}

/// One pre-formatted entry of the summary block; colorKey names a palette role.
struct WidgetSummaryEntry: Codable {
  let id: String
  let label: String
  let value: String
  let trendDir: String
  let verdict: String?
  let colorKey: String
  /// The name, the reading and the verdict as a screen reader says them. Nil on a snapshot
  /// written before schema 16.
  let spoken: String?
}

/// Ready-to-render mirror of the in-app summary card, following the app settings.
struct WidgetSummaryCard: Codable {
  let hero: WidgetSummaryEntry
  let entries: [WidgetSummaryEntry]
  /// Which snapshot sparkline to draw: "fitnessForm" | "hrv" | "none".
  let sparkline: String
}

/// Form per day, oldest first, in the unit the athlete reads it in; a day with no value is nil.
/// `zoneBounds` are where the first four zones end, in the same unit as the values.
struct WidgetFormHistory: Codable {
  let values: [Double?]
  let asPercent: Bool
  let zoneBounds: [Double]
}

struct WidgetMetricLabels: Codable {
  let form: String
  let fitness: String
  let fatigue: String
  let hrv: String
  let rhr: String
  let ramp: String?
}

struct WidgetDisplay: Codable {
  let metricLabels: WidgetMetricLabels
  let weekLabel: String
  /// Nil in a snapshot written by an older build.
  let recordLabel: String?
  /// Nil in a snapshot written by an older build.
  let perWeekSuffix: String?
  /// The refresh control's words, which say it opens the app. Nil in a snapshot written by an
  /// older build, which then draws no control.
  let openToRefreshLabel: String?
  let formZone: String?
  let impactLine: String?
  /// The words that say the numbers are as of the last sync. Present only on a
  /// snapshot a background refresh composed after its pull did not land.
  let dataAsOfLabel: String?
  /// The small label every widget draws when the numbers come from the sample
  /// library, in demo mode and while nobody is signed in. Absent on a real
  /// library.
  let demoLabel: String?
  /// One line for each chart, since a drawn line says nothing aloud. Nil on a snapshot written
  /// before schema 16.
  let chartLabels: WidgetChartLabels?
  /// The days each chart spans, drawn as its caption. Nil on a snapshot written before the
  /// captions.
  let chartSpans: WidgetChartSpans?
}

/// What each chart shows, as a screen reader says it. Nil for a chart too short to draw.
struct WidgetChartLabels: Codable {
  /// Fitness and fatigue, the chart beside every hero but HRV.
  let fitness: String?
  /// HRV, the chart beside an HRV hero.
  let hrv: String?
  /// Form over its zones, the large size's chart.
  let form: String?
}

/// The days each chart spans, as its caption reads: "30 days". Nil for a chart too short to
/// draw.
struct WidgetChartSpans: Codable {
  let fitness: String?
  let hrv: String?
  let form: String?
}

struct WidgetPaletteData: Codable {
  let background: String
  let surface: String
  let textPrimary: String
  let textSecondary: String
  let primary: String
  let gold: String
  let blue: String
  let fatigue: String?
  let chartFitness: String?
  let chartFatigue: String?
  let formHighRisk: String?
  let formOptimal: String?
  let formGreyZone: String?
  let formFresh: String?
  let formTransition: String?
  let trendUp: String
  let trendDown: String
  let trendFlat: String
  /// Absent on a snapshot written before the stale age line.
  let warning: String?
  /// One per insight tone. Absent on a snapshot written before the insights widget.
  let toneNegative: String?
  let toneCaution: String?
  let tonePositive: String?
  let toneNeutral: String?
  let toneRecord: String?
  let toneInfo: String?
  let toneOpportunity: String?
  let border: String
  /// The body diagram's untrained fill and its volume shades, lightest first. Absent on a
  /// snapshot written before the strength widget.
  let bodyFill: String?
  let strengthRamp: [String]?
}

/// A scheme the block leaves out draws the generated theme, which comes from the same tokens.
struct WidgetThemeData: Codable {
  let light: WidgetPaletteData?
  let dark: WidgetPaletteData?
}

struct WidgetSnapshot: Codable {
  /// A snapshot that is absent, or that marks an empty library, has nothing to show.
  static func isEmpty(_ snapshot: WidgetSnapshot?) -> Bool {
    snapshot == nil || snapshot?.emptyLibrary == true
  }

  let schemaVersion: Int
  let generatedAt: Double
  /// When the sync the numbers came from finished, in seconds. Present only
  /// beside `display.dataAsOfLabel`, and absent when no sync time is known.
  let dataAsOf: Double?
  let locale: String
  /// True when the library has no activity and no wellness, so the metrics are
  /// zeros and not measurements. Nil on a snapshot written before schema 8.
  let emptyLibrary: Bool?
  let metrics: WidgetMetrics
  let sparklines: WidgetSparklines
  let weekly: WidgetWeekly
  let latest: WidgetLatest?
  let impact: WidgetImpact?
  let summaryCard: WidgetSummaryCard?
  /// Six weeks of form for the large size. Nil on a snapshot written before schema 11, or with
  /// no form series.
  let formHistory: WidgetFormHistory?
  /// One entry for every metric the summary card can show, which a placement picks its own hero
  /// and supporting row from. Nil on a snapshot written before schema 12.
  let summaryMetrics: [WidgetSummaryEntry]?
  /// The metrics the card offers as its hero, in its picker's order. Nil on a snapshot written
  /// before the list.
  let summaryHeroes: [String]?
  let display: WidgetDisplay
  let theme: WidgetThemeData
  /// Recent sports capped at what a launcher shows, most recent first,
  /// pre-localised, each carrying the deep link that starts it. Nil on a
  /// snapshot written before schema 6, and empty before anything was recorded,
  /// both of which send a tap to the picker instead. The uncapped list is
  /// `recordShortcuts`, which only the App Shortcut's sport parameter needs.
  let launcherShortcuts: [WidgetRecordShortcut]?
  /// Every sport the athlete records, uncapped. The launcher takes the head of
  /// it; the widget's configure picker takes all of it, because a rider who
  /// swims once a month still wants that widget.
  let recordShortcuts: [WidgetRecordShortcut]?
  /// The Insights tab's ranked list, in its order and of every kind; each placed Insights widget
  /// filters it for itself. Nil on a snapshot written before schema 11.
  let insights: [WidgetInsight]?
  /// The strength diagram over the last 30 days. Nil on a snapshot written before schema 15.
  let strength: WidgetStrength?
}

/// One recent sport: the id, the name a surface shows, and the link that starts it.
struct WidgetRecordShortcut: Codable {
  let type: String
  let label: String
  let url: String
}

/// The link the snapshot carries for the most recent sport. The rule for a
/// missing one lives in `RecordDeepLink`, which the app target compiles too.
extension RecordDeepLink {
  static func url(for snapshot: WidgetSnapshot?) -> URL {
    url(for: snapshot?.launcherShortcuts?.first?.url)
  }
}

/// Reads the snapshot the app wrote into the shared App Group container. Infrastructure
/// constants (group id, filename) match modules/veloq-widget/ios/VeloqWidgetModule.swift.
enum WidgetSnapshotStore {
  static let appGroup = "group.com.veloq.app"
  static let fileName = "widget-snapshot.json"

  static func load() -> WidgetSnapshot? {
    guard
      let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    else { return nil }
    let url = dir.appendingPathComponent(fileName)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
  }
}

/// The sample library the gallery and a placeholder draw: the snapshot the engine composes from
/// the demo library, whose JSON is generated at prebuild from the fixture the captures draw. A
/// placeholder always draws it, so the redacted widget keeps its real shape, and the gallery draws
/// it while the athlete has nothing of their own to show, rather than the open-the-app prompt.
enum WidgetSample {
  static let snapshot: WidgetSnapshot? = try? JSONDecoder().decode(
    WidgetSnapshot.self, from: Data(json.utf8))

  /// What a gallery or home-screen snapshot draws: the athlete's own, except in the gallery
  /// while it is absent or an empty library.
  static func snapshot(stored: WidgetSnapshot?, isPreview: Bool) -> WidgetSnapshot? {
    isPreview && WidgetSnapshot.isEmpty(stored) ? snapshot : stored
  }
}
