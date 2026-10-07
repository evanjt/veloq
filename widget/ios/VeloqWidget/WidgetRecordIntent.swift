import AppIntents
import SwiftUI
import WidgetKit

// iOS 17+ configurable Record widget: long-press, Edit Widget, pick the sport.
// A widget per sport, reached through a picker rather than through a widget
// type per sport: the sport set is whatever this athlete has recorded, so a
// fixed set would bake a product decision into a build and leave a walker or a
// rower without one.
//
// The choices come from the snapshot at runtime, not from an enum compiled into
// the extension. An enum is a closed set and the sport set is not: it is
// whatever this athlete has recorded. An enum case also carries a display name,
// and those names would be English in all seventeen locales unless the
// extension shipped a strings catalogue for them, where the snapshot already
// names each sport in the athlete's own language. The entity and its query are
// shared with the Siri phrase in `RecordSportEntity.swift`.

@available(iOS 17.0, *)
struct SelectRecordSportIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Sport"
  static var description = IntentDescription("Choose which sport this widget starts.")

  /// Optional: an unconfigured widget starts the last sport recorded, which is
  /// what the Control and the Siri phrase already do.
  @Parameter(title: "Sport")
  var sport: RecordSportEntity?
}

@available(iOS 17.0, *)
struct RecordConfigProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> RecordEntry {
    RecordEntry(date: Date(), url: RecordDeepLink.picker)
  }

  func snapshot(for configuration: SelectRecordSportIntent, in context: Context) async
    -> RecordEntry
  {
    entry(for: configuration)
  }

  func timeline(for configuration: SelectRecordSportIntent, in context: Context) async
    -> Timeline<RecordEntry>
  {
    Timeline(entries: [entry(for: configuration)], policy: .never)
  }

  private func entry(for configuration: SelectRecordSportIntent) -> RecordEntry {
    let url =
      configuration.sport.map { RecordDeepLink.url(for: $0.id) }
      ?? RecordDeepLink.url(for: WidgetSnapshotStore.load())
    return RecordEntry(date: Date(), url: url)
  }
}

/// Same kind as the static one in `VeloqWidget.swift`, so a widget placed on
/// iOS 16 keeps its place and gains an Edit Widget option on the upgrade.
@available(iOS 17.0, *)
struct VeloqConfigurableRecordWidget: Widget {
  let kind = "VeloqRecordWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: kind, intent: SelectRecordSportIntent.self, provider: RecordConfigProvider()
    ) { entry in
      RecordWidgetView(url: entry.url)
    }
    .configurationDisplayName("Record")
    .description("Start recording an activity.")
    .supportedFamilies([.systemSmall])
  }
}
