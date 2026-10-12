import SwiftUI
import WidgetKit

// Insights widget: the Insights tab's top cards, one on Small, two on Medium and four on Large,
// each opening its own target. Everything it draws comes from the shared snapshot; the rows are
// the tab's own words, so nothing here is worded except the two lines that exist without them.

struct InsightsEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
  /// The kinds this widget lists; empty lists every kind.
  var kinds: [String] = []
}

/// The entry now, and a second one at the moment the snapshot turns stale, so the age line
/// changes colour then and not at the next reload.
func insightsTimeline(_ entry: InsightsEntry) -> Timeline<InsightsEntry> {
  let refresh = nextRefreshDate()
  var entries = [entry]
  if let stale = SnapshotAge.staleDate(entry.snapshot), stale > entry.date, stale < refresh {
    entries.append(InsightsEntry(date: stale, snapshot: entry.snapshot, kinds: entry.kinds))
  }
  return Timeline(entries: entries, policy: .after(refresh))
}

struct InsightsProvider: TimelineProvider {
  static func placeholderEntry() -> InsightsEntry {
    InsightsEntry(date: Date(), snapshot: WidgetSample.snapshot)
  }

  func placeholder(in context: Context) -> InsightsEntry {
    Self.placeholderEntry()
  }

  func getSnapshot(in context: Context, completion: @escaping (InsightsEntry) -> Void) {
    let snapshot = WidgetSample.snapshot(
      stored: WidgetSnapshotStore.load(), isPreview: context.isPreview)
    completion(InsightsEntry(date: Date(), snapshot: snapshot))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<InsightsEntry>) -> Void) {
    let entry = InsightsEntry(date: Date(), snapshot: WidgetSnapshotStore.load())
    completion(insightsTimeline(entry))
  }
}

extension WidgetPalette {
  /// The mark beside an insight row, in the tone the tab draws its icon in.
  func toneColor(_ tone: String?) -> Color {
    switch tone {
    case "negative": return toneNegative
    case "caution": return toneCaution
    case "positive": return tonePositive
    case "record": return toneRecord
    case "info": return toneInfo
    case "opportunity": return toneOpportunity
    default: return toneNeutral
    }
  }
}

/// One row: a tone mark, the title and, where there is room, the subtitle. On Medium and Large it
/// is its own link; Small has room for one row and the whole widget carries that row's link.
struct InsightRowView: View {
  let row: WidgetInsight
  let palette: WidgetPalette
  let size: InsightsSize
  var showsSubtitle = true

  @ViewBuilder
  var body: some View {
    if size != .small, let url = URL(string: row.url) {
      Link(destination: url) { label }
    } else {
      label
    }
  }

  private var label: some View {
    HStack(alignment: .top, spacing: WidgetTheme.Layout.gap) {
      Circle()
        .fill(palette.toneColor(row.tone))
        .frame(width: 8, height: 8)
        .spoken("tone", row.toneLabel)
        .padding(.top, 4)
      VStack(alignment: .leading, spacing: 2) {
        Text(row.title)
          .measuredText("insight title")
          .widgetFont(.label, weight: .semibold, shrinks: true)
          .foregroundColor(palette.textPrimary)
          .multilineTextAlignment(.leading)
        if showsSubtitle, let subtitle = row.subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .measuredText("insight subtitle")
            .widgetFont(.caption, shrinks: true)
            .foregroundColor(palette.textSecondary)
            .multilineTextAlignment(.leading)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    // The tone, the title and the subtitle are read as one row, the way the row is tapped.
    .accessibilityElement(children: .combine)
  }
}

struct InsightsWidgetView: View {
  @Environment(\.colorScheme) private var colorScheme
  let entry: InsightsEntry
  let family: WidgetFamily

  private var size: InsightsSize {
    switch family {
    case .systemSmall: return .small
    case .systemLarge: return .large
    default: return .medium
    }
  }

  /// "+3 more" for the rows the largest size has no room for.
  private func moreText(_ count: Int) -> String {
    NSLocalizedString("+{{rest}} more", comment: "")
      .replacingOccurrences(of: "{{rest}}", with: String(count))
  }

  /// Small has room for one row, so its row's link is the widget's; the others open the tab
  /// wherever no row is.
  private func tapURL(_ listing: InsightsContent) -> URL {
    if size == .small, let first = listing.rows.first, let url = URL(string: first.url) {
      return url
    }
    return InsightsWidgetModel.tabURL
  }

  var body: some View {
    let palette = WidgetPalette.resolve(entry.snapshot, colorScheme)
    let listing = InsightsWidgetModel.content(entry.snapshot, size: size, kinds: entry.kinds)
    Group {
      if WidgetSnapshot.isEmpty(entry.snapshot) {
        EmptyWidgetView(palette: palette)
      } else {
        content(listing, palette)
      }
    }
    .environment(\.snapshotNow, entry.date)
    .widgetURL(tapURL(listing))
    .widgetTextSize()
    .widgetBackground(
      LinearGradient(
        colors: [palette.surface, palette.background],
        startPoint: .top, endPoint: .bottom))
  }

  /// Every row whole. Where the family has no room for every subtitle, the subtitles go from the
  /// last row up, and every title stays: no line caps its count, because the choice reads each
  /// line's whole height.
  private func content(_ listing: InsightsContent, _ palette: WidgetPalette) -> some View {
    ViewThatFits(in: .vertical) {
      ForEach((0...listing.rows.count).reversed(), id: \.self) { subtitles in
        rows(listing, palette, subtitles: subtitles)
      }
    }
  }

  private func rows(_ listing: InsightsContent, _ palette: WidgetPalette, subtitles: Int)
    -> some View
  {
    VStack(alignment: .leading, spacing: WidgetTheme.Layout.gap) {
      if listing.rows.isEmpty {
        Spacer(minLength: 0)
        Text("No new insights")
          .measuredText("no insights")
          .widgetFont(.value, weight: .semibold)
          .foregroundColor(palette.textPrimary)
          .frame(maxWidth: .infinity)
          .multilineTextAlignment(.center)
        Spacer(minLength: 0)
      } else {
        ForEach(Array(listing.rows.enumerated()), id: \.offset) { index, row in
          InsightRowView(row: row, palette: palette, size: size, showsSubtitle: index < subtitles)
        }
        Spacer(minLength: 0)
        if listing.more > 0 {
          Link(destination: InsightsWidgetModel.tabURL) {
            Text(verbatim: moreText(listing.more))
              .measuredText("more")
              .widgetFont(.label)
              .foregroundColor(palette.primary)
              .lineLimit(1)
          }
        }
      }
      SnapshotAgeRow(snapshot: entry.snapshot, palette: palette, hasRoom: size != .small)
    }
    .widgetPadding(WidgetTheme.Layout.padding)
  }
}

// iOS 15/16 Insights widget: every kind. iOS 17+ replaces this with the AppIntent-configurable
// variant in WidgetInsightsIntent.swift (same kind, so placed widgets survive the upgrade).
struct VeloqInsightsWidget: Widget {
  let kind = "VeloqInsightsWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: InsightsProvider()) { entry in
      WidgetFamilyReader { InsightsWidgetView(entry: entry, family: $0) }
    }
    .configurationDisplayName("Insights")
    .description("The top cards from your Insights tab.")
    .supportedFamilies([.systemLarge, .systemMedium, .systemSmall])
  }
}
