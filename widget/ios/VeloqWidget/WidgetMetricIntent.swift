import AppIntents
import SwiftUI
import WidgetKit

// iOS 17+ configurable dashboard: long-press, Edit Widget, pick the hero metric.
// The snapshot already carries every candidate metric, so changing the selection
// re-renders locally without any app round-trip. Refresh stays push-driven from
// the app, which sidesteps the iOS 17 AppIntentTimelineProvider staleness bug.

@available(iOS 17.0, *)
enum WidgetMetric: String, AppEnum {
  case form
  case fitness
  case fatigue
  case hrv
  case rhr
  case summary

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Metric")
  }

  static var caseDisplayRepresentations: [WidgetMetric: DisplayRepresentation] {
    [
      .form: DisplayRepresentation(title: "Form"),
      .fitness: DisplayRepresentation(title: "Fitness"),
      .fatigue: DisplayRepresentation(title: "Fatigue"),
      .hrv: DisplayRepresentation(title: "HRV"),
      .rhr: DisplayRepresentation(title: "RHR"),
      .summary: DisplayRepresentation(title: "Summary"),
    ]
  }
}

@available(iOS 17.0, *)
struct SelectMetricIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Metric"
  static var description = IntentDescription("Choose which metric the widget features.")

  @Parameter(title: "Metric", default: .form)
  var metric: WidgetMetric
}

@available(iOS 17.0, *)
struct VeloqConfigProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> VeloqEntry {
    VeloqEntry(date: Date(), snapshot: nil)
  }

  func snapshot(for configuration: SelectMetricIntent, in context: Context) async -> VeloqEntry {
    VeloqEntry(
      date: Date(), snapshot: WidgetSnapshotStore.load(),
      heroKey: configuration.metric.rawValue)
  }

  func timeline(for configuration: SelectMetricIntent, in context: Context) async
    -> Timeline<VeloqEntry>
  {
    let entry = VeloqEntry(
      date: Date(), snapshot: WidgetSnapshotStore.load(),
      heroKey: configuration.metric.rawValue)
    return Timeline(entries: [entry], policy: .after(nextRefreshDate()))
  }
}

@available(iOS 17.0, *)
struct VeloqConfigurableWidget: Widget {
  let kind = "VeloqWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: kind, intent: SelectMetricIntent.self, provider: VeloqConfigProvider()
    ) { entry in
      VeloqWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Veloq")
    .description("Your form, fitness, and latest activity at a glance.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}
