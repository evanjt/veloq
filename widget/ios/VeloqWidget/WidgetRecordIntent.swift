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
// names each sport in the athlete's own language. That is the reasoning
// `VeloqAppShortcuts` follows for the phrase's parameter.

/// One sport the athlete records, as the configure sheet offers it.
///
/// The identifier is the deep link rather than the sport's type, because
/// AppIntents keeps a configured entity by its identifier alone and re-resolves
/// it through the query on every timeline. Recents are capped at four, so a
/// sport a widget was configured with drops out of the snapshot's list, and an
/// identifier that only named the type would come back as nothing: that widget
/// would quietly start whatever was recorded last. The link carries both the
/// identity and the destination, and the app composed it, so nothing here
/// builds one.
@available(iOS 17.0, *)
struct RecordSportEntity: AppEntity {
  let id: String
  let label: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Sport")
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(label)")
  }

  static var defaultQuery = RecordSportQuery()
}

@available(iOS 17.0, *)
struct RecordSportQuery: EntityQuery {
  /// What the configure sheet lists: the sports this athlete records, named in
  /// the athlete's own language by the snapshot.
  func suggestedEntities() async throws -> [RecordSportEntity] {
    RecordSportQuery.recorded()
  }

  /// What a placed widget's configuration resolves back to. An identifier the
  /// snapshot no longer lists is answered rather than dropped, so the widget
  /// keeps its sport.
  func entities(for identifiers: [String]) async throws -> [RecordSportEntity] {
    let known = RecordSportQuery.recorded()
    return identifiers.map { id in
      known.first { $0.id == id }
        ?? RecordSportEntity(id: id, label: RecordSportQuery.sportName(from: id))
    }
  }

  static func recorded() -> [RecordSportEntity] {
    (WidgetSnapshotStore.load()?.recordShortcuts ?? []).map {
      RecordSportEntity(id: $0.url, label: $0.label)
    }
  }

  /// The name for a sport the snapshot has forgotten, read back out of the link
  /// rather than composed. Untranslated, which is the honest answer once the
  /// translated one is gone, and it shows only in the configure sheet.
  static func sportName(from url: String) -> String {
    URL(string: url)?.lastPathComponent ?? url
  }
}

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
