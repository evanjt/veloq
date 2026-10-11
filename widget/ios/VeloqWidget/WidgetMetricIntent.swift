import AppIntents
import SwiftUI
import WidgetKit

// iOS 17+ configurable Summary widget: long-press, Edit Widget, pick the hero, the sparkline
// and the supporting metrics. Every parameter left at its default follows the app's summary
// card. The snapshot carries every candidate metric, so changing the selection re-renders
// locally without any app round-trip. Refresh stays push-driven from the app, which sidesteps
// the iOS 17 AppIntentTimelineProvider staleness bug.

/// The card itself, then the heroes the app's summary card offers, in its picker's order.
@available(iOS 17.0, *)
enum WidgetMetric: String, AppEnum {
  case summary
  case fitness
  case form
  case hrv

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Metric")
  }

  static var caseDisplayRepresentations: [WidgetMetric: DisplayRepresentation] {
    [
      .summary: DisplayRepresentation(title: "Summary Card"),
      .fitness: DisplayRepresentation(title: "Fitness"),
      .form: DisplayRepresentation(title: "Form"),
      .hrv: DisplayRepresentation(title: "HRV"),
    ]
  }
}

/// The metrics the app's summary card offers, which are the ones a snapshot carries an entry for.
@available(iOS 17.0, *)
enum SummaryMetric: String, AppEnum {
  case hrv
  case rhr
  case weekHours
  case weekCount
  case ftp
  case thresholdPace
  case css
  case fitness
  case form
  case weight

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Metric")
  }

  static var caseDisplayRepresentations: [SummaryMetric: DisplayRepresentation] {
    [
      .hrv: DisplayRepresentation(title: "HRV"),
      .rhr: DisplayRepresentation(title: "RHR"),
      .weekHours: DisplayRepresentation(title: "Week"),
      .weekCount: DisplayRepresentation(title: "Activities"),
      .ftp: DisplayRepresentation(title: "FTP"),
      .thresholdPace: DisplayRepresentation(title: "Pace"),
      .css: DisplayRepresentation(title: "CSS"),
      .fitness: DisplayRepresentation(title: "Fitness"),
      .form: DisplayRepresentation(title: "Form"),
      .weight: DisplayRepresentation(title: "Weight"),
    ]
  }
}

@available(iOS 17.0, *)
enum SummarySparklineChoice: String, AppEnum {
  case summary
  case on
  case off

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Show Sparkline")
  }

  static var caseDisplayRepresentations: [SummarySparklineChoice: DisplayRepresentation] {
    [
      .summary: DisplayRepresentation(title: "Summary Card"),
      .on: DisplayRepresentation(title: "On"),
      .off: DisplayRepresentation(title: "Off"),
    ]
  }
}

@available(iOS 17.0, *)
struct SelectMetricIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Metric"
  static var description = IntentDescription("Choose which metric the widget features.")

  @Parameter(title: "Metric", default: .summary)
  var metric: WidgetMetric

  @Parameter(title: "Show Sparkline", default: .summary)
  var sparkline: SummarySparklineChoice

  /// Empty follows the card's own supporting metrics.
  @Parameter(title: "Supporting Metrics", default: [])
  var supporting: [SummaryMetric]

  var placement: SummaryPlacement {
    SummaryPlacement(
      hero: metric == .summary ? nil : metric.rawValue,
      sparkline: {
        switch sparkline {
        case .summary: return nil
        case .on: return true
        case .off: return false
        }
      }(),
      supporting: supporting.map(\.rawValue))
  }
}

@available(iOS 17.0, *)
struct VeloqConfigProvider: AppIntentTimelineProvider {
  static func placeholderEntry() -> VeloqEntry {
    VeloqEntry(date: Date(), snapshot: WidgetSample.snapshot)
  }

  func placeholder(in context: Context) -> VeloqEntry {
    Self.placeholderEntry()
  }

  func snapshot(for configuration: SelectMetricIntent, in context: Context) async -> VeloqEntry {
    VeloqEntry(
      date: Date(),
      snapshot: WidgetSample.snapshot(
        stored: WidgetSnapshotStore.load(), isPreview: context.isPreview),
      placement: configuration.placement)
  }

  func timeline(for configuration: SelectMetricIntent, in context: Context) async
    -> Timeline<VeloqEntry>
  {
    let entry = VeloqEntry(
      date: Date(), snapshot: WidgetSnapshotStore.load(), placement: configuration.placement)
    return summaryTimeline(entry)
  }
}

@available(iOS 17.0, *)
struct VeloqConfigurableWidget: Widget {
  let kind = "VeloqWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: kind, intent: SelectMetricIntent.self, provider: VeloqConfigProvider()
    ) { entry in
      WidgetFamilyReader { VeloqWidgetEntryView(entry: entry, family: $0) }
    }
    .configurationDisplayName("Summary")
    .description("Your summary card from the app at a glance.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}
