import Foundation

// Decodable mirror of src/features/home/lib/widgetSnapshot.ts (schema version 7). The
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
}

struct WidgetImpact: Codable {
  let formBefore: Double
  let formAfter: Double
  let formBeforeText: String?
  let formAfterText: String?
  let formBeforeZone: String?
  let formAfterZone: String?
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
}

/// Ready-to-render mirror of the in-app summary card, following the app settings.
struct WidgetSummaryCard: Codable {
  let hero: WidgetSummaryEntry
  let entries: [WidgetSummaryEntry]
  /// Which snapshot sparkline to draw: "fitnessForm" | "hrv" | "none".
  let sparkline: String
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
  let formZone: String?
  let impactLine: String?
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
  let chartCasing: String?
  let textMuted: String?
  let formHighRisk: String?
  let formOptimal: String?
  let formGreyZone: String?
  let formFresh: String?
  let formTransition: String?
  let formHighRiskText: String?
  let formOptimalText: String?
  let formGreyZoneText: String?
  let formFreshText: String?
  let formTransitionText: String?
  let trendUp: String
  let trendDown: String
  let trendFlat: String
  let border: String
}

struct WidgetThemeData: Codable {
  let light: WidgetPaletteData
  let dark: WidgetPaletteData
}

struct WidgetSnapshot: Codable {
  /// A snapshot that is absent, or that marks an empty library, has nothing to show.
  static func isEmpty(_ snapshot: WidgetSnapshot?) -> Bool {
    snapshot == nil || snapshot?.emptyLibrary == true
  }

  let schemaVersion: Int
  let generatedAt: Double
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
