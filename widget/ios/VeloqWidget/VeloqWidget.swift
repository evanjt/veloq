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

// MARK: - Quick-Record widget (flagged off)

// Kept compiled but NOT in either bundle body below: the record surface isn't
// ready for the gallery yet. Restore by adding VeloqRecordWidget() back to the
// bundles. Static content, renders purely from the generated WidgetTheme.Record
// chrome; the whole widget deep-links into the record screen.
struct RecordEntry: TimelineEntry {
  let date: Date
}

struct RecordProvider: TimelineProvider {
  func placeholder(in context: Context) -> RecordEntry {
    RecordEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (RecordEntry) -> Void) {
    completion(RecordEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<RecordEntry>) -> Void) {
    completion(Timeline(entries: [RecordEntry(date: Date())], policy: .never))
  }
}

struct RecordWidgetView: View {
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
    .widgetURL(URL(string: "veloq://record"))
    .widgetBackground(
      LinearGradient(
        colors: [WidgetTheme.Record.gradientStart, WidgetTheme.Record.gradientEnd],
        startPoint: .top, endPoint: .bottom))
  }
}

struct VeloqRecordWidget: Widget {
  let kind = "VeloqRecordWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: RecordProvider()) { _ in
      RecordWidgetView()
    }
    .configurationDisplayName("Record")
    .description("Start recording an activity.")
    .supportedFamilies([.systemSmall])
  }
}

// MARK: - bundles

// WidgetBundle bodies can't branch on availability with different widget types,
// so a plain @main type dispatches between the iOS 17 bundle (configurable
// dashboard) and the iOS 15/16 bundle (static dashboard).
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

struct VeloqWidgets: WidgetBundle {
  var body: some Widget {
    VeloqWidget()
    VeloqLatestActivityWidget()
  }
}

@available(iOS 17.0, *)
struct VeloqWidgetsConfigurable: WidgetBundle {
  var body: some Widget {
    VeloqConfigurableWidget()
    VeloqLatestActivityWidget()
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
