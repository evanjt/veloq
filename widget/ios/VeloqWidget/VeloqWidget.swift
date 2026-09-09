import SwiftUI
import WidgetKit

struct VeloqEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
  var heroKey: String = "form"
}

// Refresh is push-driven from the app (WidgetCenter.reloadAllTimelines). The long
// fallback only ensures a missed reload self-heals within a few hours.
func nextRefreshDate() -> Date {
  Calendar.current.date(byAdding: .hour, value: 4, to: Date())
    ?? Date().addingTimeInterval(14_400)
}

struct VeloqProvider: TimelineProvider {
  func placeholder(in context: Context) -> VeloqEntry {
    VeloqEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (VeloqEntry) -> Void) {
    completion(VeloqEntry(date: Date(), snapshot: WidgetSnapshotStore.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<VeloqEntry>) -> Void) {
    let entry = VeloqEntry(date: Date(), snapshot: WidgetSnapshotStore.load())
    completion(Timeline(entries: [entry], policy: .after(nextRefreshDate())))
  }
}

struct VeloqWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  let entry: VeloqEntry

  var body: some View {
    let palette = WidgetPalette.resolve(entry.snapshot, colorScheme)
    Group {
      switch family {
      case .systemSmall:
        SmallWidgetView(snapshot: entry.snapshot, palette: palette, heroKey: entry.heroKey)
      case .systemLarge:
        LargeWidgetView(snapshot: entry.snapshot, palette: palette)
      default:
        MediumWidgetView(snapshot: entry.snapshot, palette: palette, heroKey: entry.heroKey)
      }
    }
    .widgetBackground(
      LinearGradient(
        colors: [palette.surface, palette.background],
        startPoint: .top, endPoint: .bottom))
  }
}

// iOS 15/16 dashboard: fixed form hero. iOS 17+ replaces this with the
// AppIntent-configurable variant in WidgetMetricIntent.swift (same kind, so
// placed widgets survive the upgrade).
struct VeloqWidget: Widget {
  let kind = "VeloqWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: VeloqProvider()) { entry in
      VeloqWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Veloq")
    .description("Your form, fitness, and latest activity at a glance.")
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
      Text("Record")
        .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
        .foregroundColor(WidgetTheme.Record.foreground)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .widgetURL(url)
    .widgetBackground(
      LinearGradient(
        colors: [WidgetTheme.Record.gradientStart, WidgetTheme.Record.gradientEnd],
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
}
