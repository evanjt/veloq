import AppIntents
import SwiftUI
import WidgetKit

// iOS 17+ configurable Insights widget: long-press, Edit Widget, pick the kinds of insight it
// lists. Left empty it lists every kind. The snapshot carries the Insights tab's whole list, so
// changing the pick re-renders locally without any app round-trip.

@available(iOS 17.0, *)
enum InsightKind: String, AppEnum {
  case sectionPr = "section_pr"
  case sectionTrend = "section_trend"
  case route = "route"
  case stalePr = "stale_pr"
  case fitnessMilestone = "fitness_milestone"
  case periodComparison = "period_comparison"
  case strengthProgression = "strength_progression"
  case strengthBalance = "strength_balance"
  case hrvTrend = "hrv_trend"
  case efficiencyTrend = "efficiency_trend"
  case sectionChanged = "section_changed"

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Kinds")
  }

  static var caseDisplayRepresentations: [InsightKind: DisplayRepresentation] {
    [
      .sectionPr: DisplayRepresentation(title: "Section PRs"),
      .sectionTrend: DisplayRepresentation(title: "Section trends"),
      .route: DisplayRepresentation(title: "Route records"),
      .stalePr: DisplayRepresentation(title: "Old PRs"),
      .fitnessMilestone: DisplayRepresentation(title: "Fitness milestones"),
      .periodComparison: DisplayRepresentation(title: "Period comparisons"),
      .strengthProgression: DisplayRepresentation(title: "Strength progression"),
      .strengthBalance: DisplayRepresentation(title: "Strength balance"),
      .hrvTrend: DisplayRepresentation(title: "HRV trends"),
      .efficiencyTrend: DisplayRepresentation(title: "Efficiency trends"),
      .sectionChanged: DisplayRepresentation(title: "Changed sections"),
    ]
  }
}

@available(iOS 17.0, *)
struct SelectInsightKindsIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Kinds"
  static var description = IntentDescription(
    "Choose which kinds of insight the widget lists. Choosing none lists every kind.")

  /// Empty lists every kind.
  @Parameter(title: "Kinds", default: [])
  var kinds: [InsightKind]
}

@available(iOS 17.0, *)
struct InsightsConfigProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> InsightsEntry {
    InsightsEntry(date: Date(), snapshot: nil)
  }

  func snapshot(for configuration: SelectInsightKindsIntent, in context: Context) async
    -> InsightsEntry
  {
    InsightsEntry(
      date: Date(), snapshot: WidgetSnapshotStore.load(),
      kinds: configuration.kinds.map(\.rawValue))
  }

  func timeline(for configuration: SelectInsightKindsIntent, in context: Context) async
    -> Timeline<InsightsEntry>
  {
    insightsTimeline(
      InsightsEntry(
        date: Date(), snapshot: WidgetSnapshotStore.load(),
        kinds: configuration.kinds.map(\.rawValue)))
  }
}

@available(iOS 17.0, *)
struct VeloqConfigurableInsightsWidget: Widget {
  let kind = "VeloqInsightsWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: kind, intent: SelectInsightKindsIntent.self, provider: InsightsConfigProvider()
    ) { entry in
      InsightsWidgetView(entry: entry)
    }
    .configurationDisplayName("Insights")
    .description("The top cards from your Insights tab.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}
