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

/// The entry now, and a second one at the moment the snapshot turns stale, so the age line
/// changes colour then and not at the next reload.
func summaryTimeline(_ entry: VeloqEntry) -> Timeline<VeloqEntry> {
  let refresh = nextRefreshDate()
  var entries = [entry]
  if let stale = SnapshotAge.staleDate(entry.snapshot), stale > entry.date, stale < refresh {
    entries.append(
      VeloqEntry(date: stale, snapshot: entry.snapshot, placement: entry.placement))
  }
  return Timeline(entries: entries, policy: .after(refresh))
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
    }
    .configurationDisplayName("Summary")
    .description("Your summary card from the app at a glance.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}

// MARK: - Quick-Record widget

// In both generated bundle bodies since INCLUDE_RECORD_WIDGET went true; the
// plugin drops it from them again if the flag goes back off. The chrome renders
// purely from the generated WidgetTheme.Record
// values; the snapshot is read for one field, the last recorded sport, which
// decides whether the tap starts a ride or opens the picker.
struct RecordEntry: TimelineEntry {
  let date: Date
  let url: URL
}

struct RecordProvider: TimelineProvider {
  func placeholder(in context: Context) -> RecordEntry {
    RecordEntry(date: Date(), url: RecordDeepLink.picker)
  }

  func getSnapshot(in context: Context, completion: @escaping (RecordEntry) -> Void) {
    completion(entry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<RecordEntry>) -> Void) {
    completion(Timeline(entries: [entry()], policy: .never))
  }

  private func entry() -> RecordEntry {
    RecordEntry(date: Date(), url: RecordDeepLink.url(for: WidgetSnapshotStore.load()))
  }
}

struct RecordWidgetView: View {
  @Environment(\.colorScheme) private var colorScheme
  let url: URL

  var body: some View {
    VStack(spacing: WidgetTheme.Layout.gap) {
      ZStack {
        Circle()
          .stroke(WidgetTheme.Record.foreground, lineWidth: 3)
          .frame(width: 44, height: 44)
        Circle()
          .fill(WidgetTheme.Record.foreground)
          .frame(width: 26, height: 26)
      }
      .unspoken()
      Text("Record")
        .measuredText("record")
        .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
        .foregroundColor(WidgetTheme.Record.foreground)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .widgetURL(url)
    .widgetBackground(
      LinearGradient(
        colors: colorScheme == .dark
          ? [WidgetTheme.Record.Dark.gradientStart, WidgetTheme.Record.Dark.gradientEnd]
          : [WidgetTheme.Record.Light.gradientStart, WidgetTheme.Record.Light.gradientEnd],
        startPoint: .top, endPoint: .bottom))
  }
}

struct VeloqRecordWidget: Widget {
  let kind = "VeloqRecordWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: RecordProvider()) { entry in
      RecordWidgetView(url: entry.url)
    }
    .configurationDisplayName("Record")
    .description("Start recording an activity.")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - bundles

// WidgetBundle bodies can't branch on availability with different widget types,
// so a plain @main type dispatches between the iOS 17 bundle (configurable
// dashboard) and the iOS 15/16 bundle (static dashboard). Both bundles are
// generated into WidgetBundles.swift at prebuild, because their membership is
// the Quick-Record gate and a result builder cannot read a JavaScript flag.
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
