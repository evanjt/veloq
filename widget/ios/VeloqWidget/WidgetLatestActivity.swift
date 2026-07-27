import SwiftUI
import WidgetKit

// Latest Activity widget: a native-drawn route outline of the most recent GPS
// activity with its headline stats. The whole widget deep-links into the activity
// detail screen. Indoor/no-GPS activities fall back to a text card with a map
// glyph. All data comes from the shared snapshot; nothing is computed here.

struct LatestActivityProvider: TimelineProvider {
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

/// Draws the normalised (0..1, y-down) route points letterboxed into the rect,
/// preserving the track's projected aspect ratio.
struct RoutePreviewShape: Shape {
  let points: [[Double]]
  let aspect: Double

  func path(in rect: CGRect) -> Path {
    var path = Path()
    guard points.count >= 2, rect.width > 0, rect.height > 0 else { return path }

    var w = rect.width
    var h = rect.height
    let boxAspect = Double(w / h)
    let a = aspect > 0 ? aspect : 1
    if a > boxAspect {
      h = w / CGFloat(a)
    } else {
      w = h * CGFloat(a)
    }
    let ox = rect.midX - w / 2
    let oy = rect.midY - h / 2

    func pt(_ p: [Double]) -> CGPoint? {
      guard p.count >= 2 else { return nil }
      return CGPoint(x: ox + CGFloat(p[0]) * w, y: oy + CGFloat(p[1]) * h)
    }

    guard let first = pt(points[0]) else { return path }
    path.move(to: first)
    for p in points.dropFirst() {
      if let q = pt(p) { path.addLine(to: q) }
    }
    return path
  }
}

struct RoutePreviewView: View {
  let preview: WidgetRoutePreview?
  let tint: Color

  var body: some View {
    if let preview = preview, preview.points.count >= 2 {
      RoutePreviewShape(points: preview.points, aspect: preview.aspect)
        .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
    } else {
      Image(systemName: "map")
        .font(.system(size: WidgetTheme.TypeScale.metric, weight: .semibold))
        .foregroundColor(tint)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

struct LatestActivityView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  let entry: VeloqEntry

  var body: some View {
    let palette = WidgetPalette.resolve(entry.snapshot, colorScheme)
    Group {
      if let latest = entry.snapshot?.latest {
        content(latest, palette)
          .widgetURL(activityURL(latest))
      } else {
        EmptyWidgetView(palette: palette)
      }
    }
    .widgetBackground(
      LinearGradient(
        colors: [palette.surface, palette.background],
        startPoint: .top, endPoint: .bottom))
  }

  @ViewBuilder
  private func content(_ latest: WidgetLatest, _ palette: WidgetPalette) -> some View {
    let tint = Color(hex: latest.tintHex)
    if family == .systemSmall {
      VStack(alignment: .leading, spacing: 4) {
        RoutePreviewView(preview: latest.routePreview, tint: tint)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        HStack(spacing: 4) {
          Text(latest.name)
            .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
            .foregroundColor(tint)
            .lineLimit(1)
          if latest.isPr == true {
            Circle().fill(palette.gold).frame(width: 6, height: 6)
          }
        }
        Text(subtitle(latest))
          .font(.system(size: WidgetTheme.TypeScale.caption))
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
      }
      .padding(WidgetTheme.Layout.padding)
    } else {
      HStack(spacing: WidgetTheme.Layout.gap) {
        RoutePreviewView(preview: latest.routePreview, tint: tint)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 4) {
            Text(latest.name)
              .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
              .foregroundColor(tint)
              .lineLimit(2)
            if latest.isPr == true {
              Circle().fill(palette.gold).frame(width: 6, height: 6)
            }
          }
          Text(subtitle(latest))
            .font(.system(size: WidgetTheme.TypeScale.label))
            .foregroundColor(palette.textSecondary)
            .lineLimit(2)
          if let tss = latest.trainingLoad {
            Text("\(Int(tss.rounded())) TSS")
              .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
              .foregroundColor(palette.textPrimary)
          }
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(WidgetTheme.Layout.padding)
    }
  }

  private func subtitle(_ l: WidgetLatest) -> String {
    [l.distanceLabel, l.durationLabel, l.dateLabel].filter { !$0.isEmpty }.joined(separator: " · ")
  }

  private func activityURL(_ latest: WidgetLatest) -> URL? {
    guard let id = latest.activityId, !id.isEmpty else { return URL(string: "veloq://") }
    return URL(string: "veloq://activity/\(id)")
  }
}

struct VeloqLatestActivityWidget: Widget {
  let kind = "VeloqLatestActivityWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: LatestActivityProvider()) { entry in
      LatestActivityView(entry: entry)
    }
    .configurationDisplayName("Latest Activity")
    .description("Your most recent activity with its route.")
    .supportedFamilies([.systemMedium, .systemSmall])
  }
}
