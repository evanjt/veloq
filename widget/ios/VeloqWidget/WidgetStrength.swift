import SwiftUI
import WidgetKit

// Strength widget: the strength tab's body, each muscle shaded by the sets it took over the
// window. The front on Small, the front and back on Medium, and the most trained muscles beneath
// them on Large. Everything it draws comes from the shared snapshot, worded by the engine.

struct StrengthEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
  var window: StrengthWindowChoice = .last30
}

/// The entry now, and a second one at the moment the snapshot turns stale, so the age line
/// changes colour then and not at the next reload.
func strengthTimeline(_ entry: StrengthEntry) -> Timeline<StrengthEntry> {
  let refresh = nextRefreshDate()
  var entries = [entry]
  if let stale = SnapshotAge.staleDate(entry.snapshot), stale > entry.date, stale < refresh {
    entries.append(StrengthEntry(date: stale, snapshot: entry.snapshot, window: entry.window))
  }
  return Timeline(entries: entries, policy: .after(refresh))
}

struct StrengthProvider: TimelineProvider {
  func placeholder(in context: Context) -> StrengthEntry {
    StrengthEntry(date: Date(), snapshot: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (StrengthEntry) -> Void) {
    completion(StrengthEntry(date: Date(), snapshot: WidgetSnapshotStore.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StrengthEntry>) -> Void) {
    completion(strengthTimeline(StrengthEntry(date: Date(), snapshot: WidgetSnapshotStore.load())))
  }
}

/// One of the most trained muscles: its shade, its name, and its sets and volume.
struct StrengthTopRow: View {
  let muscle: WidgetStrengthTopMuscle
  let color: Color
  let palette: WidgetPalette

  var body: some View {
    HStack(spacing: WidgetTheme.Layout.gap) {
      Circle()
        .fill(color)
        .frame(width: 8, height: 8)
      Text(muscle.name)
        .measuredText("muscle name")
        .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
        .foregroundColor(palette.textPrimary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      Spacer(minLength: WidgetTheme.Layout.gap)
      Text(muscle.setsText)
        .measuredText("muscle sets")
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textPrimary)
        .lineLimit(1)
      if let volume = muscle.volumeText {
        Text(volume)
          .measuredText("muscle volume")
          .font(.system(size: WidgetTheme.TypeScale.label))
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
      }
    }
  }
}

struct StrengthWidgetView: View {
  @Environment(\.colorScheme) private var colorScheme
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
    let content = StrengthWidgetModel.content(entry.snapshot, size: size, choice: entry.window)
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
      .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
      .foregroundColor(palette.textSecondary)
      .lineLimit(1)
  }

  private func bodies(_ content: StrengthContent, _ palette: WidgetPalette) -> some View {
    HStack(spacing: WidgetTheme.Layout.gap) {
      ForEach(Array(content.sides.enumerated()), id: \.offset) { _, side in
        BodyView(female: content.female, side: side, shades: content.shades, palette: palette)
      }
    }
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
          SnapshotAgeLine(snapshot: entry.snapshot, palette: palette)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(WidgetTheme.Layout.padding)
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
          .font(
            .system(
              size: size == .large ? WidgetTheme.TypeScale.value : WidgetTheme.TypeScale.label,
              weight: .semibold)
          )
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
                muscle: muscle, color: palette.strengthFill(content.shades[muscle.slug]),
                palette: palette)
            }
          }
        }
      }
      SnapshotAgeLine(snapshot: entry.snapshot, palette: palette)
    }
    .padding(size == .small ? WidgetTheme.Layout.gap : WidgetTheme.Layout.padding)
  }
}

// iOS 15/16 Strength widget: the last 30 days. iOS 17+ replaces this with the AppIntent-
// configurable variant in WidgetStrengthIntent.swift (same kind, so placed widgets survive the
// upgrade).
struct VeloqStrengthWidget: Widget {
  let kind = "VeloqStrengthWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: StrengthProvider()) { entry in
      WidgetFamilyReader { StrengthWidgetView(entry: entry, family: $0) }
    }
    .configurationDisplayName("Strength")
    .description("The muscles you trained, shaded by sets.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}
