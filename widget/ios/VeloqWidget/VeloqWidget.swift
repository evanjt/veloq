import SwiftUI
import WidgetKit

struct VeloqEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
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
    // Refresh is push-driven from the app (WidgetCenter.reloadAllTimelines). The long
    // fallback only ensures a missed reload self-heals within a few hours.
    let next =
      Calendar.current.date(byAdding: .hour, value: 4, to: Date())
      ?? Date().addingTimeInterval(14_400)
    completion(Timeline(entries: [entry], policy: .after(next)))
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
        SmallWidgetView(snapshot: entry.snapshot, palette: palette)
      case .systemLarge:
        LargeWidgetView(snapshot: entry.snapshot, palette: palette)
      default:
        MediumWidgetView(snapshot: entry.snapshot, palette: palette)
      }
    }
    .widgetBackground(palette.background)
  }
}

struct VeloqWidget: Widget {
  let kind = "VeloqWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: VeloqProvider()) { entry in
      VeloqWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Veloq")
    .description("Your form, fitness, and latest activity at a glance.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct VeloqWidgetBundle: WidgetBundle {
  var body: some Widget {
    VeloqWidget()
  }
}

extension View {
  // iOS 17 requires containerBackground; 15/16 fall back to a plain background.
  @ViewBuilder
  func widgetBackground(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(color, for: .widget)
    } else {
      background(color)
    }
  }
}
