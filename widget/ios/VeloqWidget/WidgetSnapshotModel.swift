import Foundation

// Decodable mirror of src/features/home/lib/widgetSnapshot.ts (schema version 2). The
// widget only renders this — it never computes. Optional fields decode to nil when the
// key is missing, so a partial snapshot degrades gracefully instead of failing to decode.

struct WidgetMetric: Codable {
  let value: Double
  let trendDir: String
  let deltaVsYesterday: Double?
}

struct WidgetMetrics: Codable {
  let form: WidgetMetric
  let fitness: WidgetMetric
  let fatigue: WidgetMetric
  let hrv: WidgetMetric
  let rhr: WidgetMetric
}

struct WidgetSparklines: Codable {
  let form: [Double]
  let fitness: [Double]
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

struct WidgetLatest: Codable {
  let name: String
  let sportType: String
  let distanceLabel: String
  let durationLabel: String
  let dateLabel: String
  let trainingLoad: Double?
  let tintHex: String
}

struct WidgetImpact: Codable {
  let formBefore: Double
  let formAfter: Double
  let ctlDelta: Double
  let atlDelta: Double
  let tssAdded: Double?
  let dateLabel: String
}

struct WidgetMetricLabels: Codable {
  let form: String
  let fitness: String
  let fatigue: String
  let hrv: String
  let rhr: String
}

struct WidgetDisplay: Codable {
  let metricLabels: WidgetMetricLabels
  let weekLabel: String
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
  let schemaVersion: Int
  let generatedAt: Double
  let locale: String
  let metrics: WidgetMetrics
  let sparklines: WidgetSparklines
  let weekly: WidgetWeekly
  let latest: WidgetLatest?
  let impact: WidgetImpact?
  let display: WidgetDisplay
  let theme: WidgetThemeData
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
