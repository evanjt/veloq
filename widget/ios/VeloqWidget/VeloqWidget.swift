import SwiftUI
import WidgetKit

struct VeloqEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
  /// What this widget was configured with; unconfigured follows the app's summary card.
  var placement: SummaryPlacement = .followCard
}

// Refresh is push-driven from the app (WidgetCenter.reloadAllTimelines). The long
// fallback only ensures a missed reload self-heals within a few hours.
func nextRefreshDate() -> Date {
  Calendar.current.date(byAdding: .hour, value: 4, to: Date())
    ?? Date().addingTimeInterval(14_400)
}

/// The entry now, and one at each moment the age line's words change before the next reload,
/// so it moves on from now to minutes to hours, and turns amber, without a reload.
func summaryTimeline(_ entry: VeloqEntry) -> Timeline<VeloqEntry> {
  let refresh = nextRefreshDate()
  let changes = SnapshotAge.changes(entry.snapshot, after: entry.date, before: refresh)
  return Timeline(
    entries: [entry] + changes.map { change in
      VeloqEntry(date: change, snapshot: entry.snapshot, placement: entry.placement)
    },
    policy: .after(refresh))
}

struct VeloqProvider: TimelineProvider {
  static func placeholderEntry() -> VeloqEntry {
    VeloqEntry(date: Date(), snapshot: WidgetSample.snapshot)
  }

  func placeholder(in context: Context) -> VeloqEntry {
    Self.placeholderEntry()
  }

  func getSnapshot(in context: Context, completion: @escaping (VeloqEntry) -> Void) {
    let snapshot = WidgetSample.snapshot(
      stored: WidgetSnapshotStore.load(), isPreview: context.isPreview)
    completion(VeloqEntry(date: Date(), snapshot: snapshot))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<VeloqEntry>) -> Void) {
    let entry = VeloqEntry(date: Date(), snapshot: WidgetSnapshotStore.load())
    completion(summaryTimeline(entry))
  }
}

struct VeloqWidgetEntryView: View {
  @Environment(\.colorScheme) private var colorScheme
  let entry: VeloqEntry
  let family: WidgetFamily

  private var size: SummarySize {
    switch family {
    case .systemSmall: return .small
    case .systemLarge: return .large
    default: return .medium
    }
  }

  var body: some View {
    let palette = WidgetPalette.resolve(entry.snapshot, colorScheme)
    SummaryWidgetView(
      snapshot: entry.snapshot, palette: palette, size: size, placement: entry.placement
    )
    .environment(\.snapshotNow, entry.date)
    .widgetURL(SummaryDeepLink.fitness)
    .widgetBackground(
      LinearGradient(
        colors: [palette.surface, palette.background],
        startPoint: .top, endPoint: .bottom))
  }
}

// iOS 15/16 Summary widget: the summary card as the app has it. iOS 17+ replaces this with the
// AppIntent-configurable variant in WidgetMetricIntent.swift (same kind, so placed widgets
// survive the upgrade).
struct VeloqWidget: Widget {
  let kind = "VeloqWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: VeloqProvider()) { entry in
      WidgetFamilyReader { VeloqWidgetEntryView(entry: entry, family: $0) }
        .snapshotLocale(entry.snapshot)
    }
    .configurationDisplayName("Summary")
    .description("Your summary card from the app at a glance.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}

// MARK: - bundles

// WidgetBundle bodies can't branch on availability with different widget types,
// so a plain @main type dispatches between the iOS 17 bundle (configurable
// dashboard) and the iOS 15/16 bundle (static dashboard). Both bundles are
// generated into WidgetBundles.swift at prebuild.
@main
struct VeloqWidgetLauncher {
  static func main() {
    if #available(iOS 17.0, *) {
      VeloqWidgetsConfigurable.main()
    } else {
      VeloqWidgets.main()
    }
  }
}

/// WidgetKit's family is read-only in the environment, so each widget reads it here and hands it
/// to a view that takes it as a value, which a capture can then draw at every family.
struct WidgetFamilyReader<Content: View>: View {
  @Environment(\.widgetFamily) private var family
  let content: (WidgetFamily) -> Content

  var body: some View {
    content(family)
  }
}

extension View {
  /// The widget formats its own dates in the language the app wrote the snapshot in, so the age
  /// line reads in the same language as the words beside it. With no snapshot, the phone's.
  @ViewBuilder
  func snapshotLocale(_ snapshot: WidgetSnapshot?) -> some View {
    if let tag = snapshot?.locale, !tag.isEmpty {
      environment(\.locale, Locale(identifier: tag))
    } else {
      self
    }
  }

  // iOS 17 requires containerBackground; 15/16 fall back to a plain background.
  @ViewBuilder
  func widgetBackground<S: ShapeStyle>(_ style: S) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(style, for: .widget)
    } else {
      background(style)
    }
  }

  // From iOS 17 the Home Screen keeps its own margin inside every widget, so padding there too
  // spends the room twice. Only 15/16, which keep none, get this padding.
  @ViewBuilder
  func widgetPadding(_ edges: Edge.Set, _ length: CGFloat) -> some View {
    if #available(iOS 17.0, *) {
      self
    } else {
      padding(edges, length)
    }
  }

  func widgetPadding(_ length: CGFloat) -> some View {
    widgetPadding(.all, length)
  }
}
