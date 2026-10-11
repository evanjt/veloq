import AppIntents
import SwiftUI
import WidgetKit

// iOS 17+ configurable Strength widget: long-press, Edit Widget, pick the period it shades. The
// snapshot carries both windows, so changing the pick re-renders locally without any app
// round-trip.

@available(iOS 17.0, *)
enum StrengthPeriod: String, AppEnum {
  case last30
  case month

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Period")
  }

  static var caseDisplayRepresentations: [StrengthPeriod: DisplayRepresentation] {
    [
      .last30: DisplayRepresentation(title: "Last 30 days"),
      .month: DisplayRepresentation(title: "This Month"),
    ]
  }

  var choice: StrengthWindowChoice {
    StrengthWindowChoice(rawValue: rawValue) ?? .last30
  }
}

@available(iOS 17.0, *)
struct SelectStrengthWindowIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Period"
  static var description = IntentDescription("Choose which days the widget shades.")

  @Parameter(title: "Period", default: .last30)
  var period: StrengthPeriod
}

@available(iOS 17.0, *)
struct StrengthConfigProvider: AppIntentTimelineProvider {
  static func placeholderEntry() -> StrengthEntry {
    StrengthEntry(date: Date(), snapshot: WidgetSample.snapshot)
  }

  func placeholder(in context: Context) -> StrengthEntry {
    Self.placeholderEntry()
  }

  func snapshot(for configuration: SelectStrengthWindowIntent, in context: Context) async
    -> StrengthEntry
  {
    StrengthEntry(
      date: Date(),
      snapshot: WidgetSample.snapshot(
        stored: WidgetSnapshotStore.load(), isPreview: context.isPreview),
      window: configuration.period.choice)
  }

  func timeline(for configuration: SelectStrengthWindowIntent, in context: Context) async
    -> Timeline<StrengthEntry>
  {
    strengthTimeline(
      StrengthEntry(
        date: Date(), snapshot: WidgetSnapshotStore.load(), window: configuration.period.choice))
  }
}

@available(iOS 17.0, *)
struct VeloqConfigurableStrengthWidget: Widget {
  let kind = "VeloqStrengthWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: kind, intent: SelectStrengthWindowIntent.self, provider: StrengthConfigProvider()
    ) { entry in
      WidgetFamilyReader { StrengthWidgetView(entry: entry, family: $0) }
    }
    .configurationDisplayName("Strength")
    .description("The muscles you trained, shaded by sets.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}
