import SwiftUI
import WidgetKit

// Strength widget: the strength tab's body, each muscle shaded by the sets it took over the last
// 30 days. The front on Small, the front and back on Medium, and the most trained muscles beneath
// them on Large. Everything it draws comes from the shared snapshot, worded by the engine.

struct StrengthEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
}

/// The entry now, and one at each moment the age line's words change before the next reload,
/// so it moves on from now to minutes to hours, and turns amber, without a reload.
func strengthTimeline(_ entry: StrengthEntry) -> Timeline<StrengthEntry> {
  let refresh = nextRefreshDate()
  let changes = SnapshotAge.changes(entry.snapshot, after: entry.date, before: refresh)
  return Timeline(
    entries: [entry] + changes.map { change in
      StrengthEntry(date: change, snapshot: entry.snapshot)
    },
    policy: .after(refresh))
}

struct StrengthProvider: TimelineProvider {
  static func placeholderEntry() -> StrengthEntry {
    StrengthEntry(date: Date(), snapshot: WidgetSample.snapshot)
  }

  func placeholder(in context: Context) -> StrengthEntry {
    Self.placeholderEntry()
  }

  func getSnapshot(in context: Context, completion: @escaping (StrengthEntry) -> Void) {
    let snapshot = WidgetSample.snapshot(
      stored: WidgetSnapshotStore.load(), isPreview: context.isPreview)
    completion(StrengthEntry(date: Date(), snapshot: snapshot))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StrengthEntry>) -> Void) {
    completion(strengthTimeline(StrengthEntry(date: Date(), snapshot: WidgetSnapshotStore.load())))
  }
}

/// One of the most trained muscles: its shade, its name, how often a week, its sets and its volume.
/// The volume is dropped when the row has no room for it, then the sets.
struct StrengthTopRow: View {
  let muscle: WidgetStrengthTopMuscle
  let color: Color
  let palette: WidgetPalette

  var body: some View {
    HStack(spacing: WidgetTheme.Layout.gap) {
      Circle()
        .fill(color)
        .frame(width: 8, height: 8)
        .widgetAccentable()
        .unspoken()
      Text(muscle.name)
        .measuredText("muscle name")
        .widgetFont(.label, weight: .semibold, shrinks: true)
        .foregroundColor(palette.textPrimary)
        .lineLimit(1)
      Spacer(minLength: WidgetTheme.Layout.gap)
      ViewThatFits(in: .horizontal) {
        figures(withSets: true, withVolume: true)
        figures(withSets: true, withVolume: false)
        figures(withSets: muscle.frequencyText == nil, withVolume: false)
      }
    }
  }

  private func figures(withSets: Bool, withVolume: Bool) -> some View {
    HStack(spacing: WidgetTheme.Layout.gap) {
      if let frequency = muscle.frequencyText {
        Text(frequency)
          .measuredText("muscle frequency")
          .widgetFont(.label)
          .foregroundColor(palette.textPrimary)
          .lineLimit(1)
      }
      if withSets {
        Text(muscle.setsText)
          .measuredText("muscle sets")
          .widgetFont(.label)
          .foregroundColor(palette.textPrimary)
          .lineLimit(1)
      }
      if withVolume, let volume = muscle.volumeText {
        Text(volume)
          .measuredText("muscle volume")
          .widgetFont(.label)
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
      }
    }
  }
}

struct StrengthWidgetView: View {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetRenderingMode) private var renderingMode
  let entry: StrengthEntry
  let family: WidgetFamily

  private var size: StrengthSize {
    switch family {
    case .systemSmall: return .small
    case .systemLarge: return .large
    default: return .medium
    }
  }

  var body: some View {
    let palette = WidgetPalette.resolve(entry.snapshot, colorScheme)
    let content = StrengthWidgetModel.content(entry.snapshot, size: size)
    Group {
      if WidgetSnapshot.isEmpty(entry.snapshot) || content == nil {
        EmptyWidgetView(palette: palette)
      } else if let content {
        drawing(content, palette)
      }
    }
    .environment(\.snapshotNow, entry.date)
    .widgetURL(content?.url)
    .widgetBackground(
      LinearGradient(
        colors: [palette.surface, palette.background],
        startPoint: .top, endPoint: .bottom))
  }

  private func windowLabel(_ content: StrengthContent, _ palette: WidgetPalette) -> some View {
    Text(content.label)
      .measuredText("window")
      .widgetFont(.label, weight: .semibold)
      .foregroundColor(palette.textSecondary)
      .lineLimit(1)
  }

  private func bodies(_ content: StrengthContent, _ palette: WidgetPalette) -> some View {
    HStack(spacing: WidgetTheme.Layout.gap) {
      ForEach(Array(content.sides.enumerated()), id: \.offset) { _, side in
        BodyView(
          female: content.female, side: side, shades: content.shades, palette: palette,
          accented: renderingMode == .accented)
      }
    }
    .spoken("body", content.bodyLabel)
  }

  /// Medium is wide and short, so the bodies take its whole height and the words stand beside
  /// them; the other sizes stack the words above and below.
  @ViewBuilder
  private func drawing(_ content: StrengthContent, _ palette: WidgetPalette) -> some View {
    if size == .medium, content.emptyText == nil {
      HStack(spacing: WidgetTheme.Layout.padding) {
        bodies(content, palette)
          .frame(maxHeight: .infinity)
          .layoutPriority(1)
        VStack(alignment: .leading, spacing: WidgetTheme.Layout.gap) {
          windowLabel(content, palette)
          Spacer(minLength: 0)
          SnapshotAgeRow(snapshot: entry.snapshot, palette: palette, hasRoom: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .widgetPadding(WidgetTheme.Layout.padding)
    } else {
      stacked(content, palette)
    }
  }

  private func stacked(_ content: StrengthContent, _ palette: WidgetPalette) -> some View {
    VStack(alignment: .leading, spacing: size == .small ? 4 : WidgetTheme.Layout.gap) {
      windowLabel(content, palette)
      if let words = content.emptyText {
        Text(words)
          .measuredText("empty window")
          .widgetProseFont(size == .large ? .value : .label, weight: .semibold, shrinks: true)
          .foregroundColor(palette.textPrimary)
          .multilineTextAlignment(.center)
          .lineLimit(4)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        bodies(content, palette)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        if !content.top.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(content.top.enumerated()), id: \.offset) { _, muscle in
              StrengthTopRow(
                muscle: muscle,
                color: palette.strengthFill(
                  content.shades[muscle.slug], accented: renderingMode == .accented),
                palette: palette)
            }
          }
        }
      }
      SnapshotAgeRow(snapshot: entry.snapshot, palette: palette, hasRoom: size != .small)
    }
    .widgetPadding(size == .small ? WidgetTheme.Layout.gap : WidgetTheme.Layout.padding)
  }
}

// The Strength widget on every iOS version: the last 30 days, with nothing to edit. It keeps the
// kind the iOS 17 placements had while they offered a period, so a placed widget keeps its place.
struct VeloqStrengthWidget: Widget {
  let kind = "VeloqStrengthWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: StrengthProvider()) { entry in
      WidgetFamilyReader { StrengthWidgetView(entry: entry, family: $0) }
        .snapshotLocale(entry.snapshot)
    }
    .configurationDisplayName("Strength")
    .description("The muscles you trained, shaded by sets.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}
