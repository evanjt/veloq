import SwiftUI
import WidgetKit

// Last activity widget: how the most recent activity compared, with a native-drawn route outline
// of its track. It leads with the rank among the attempts at its route and the gap to the
// record, every attempt as a dot, or with no route its load against the typical one; below come
// the section records, the load and the form before and after. The whole widget deep-links into
// the activity detail screen. What each size draws is decided in LastActivityWidgetModel; all
// data comes from the shared snapshot and nothing is computed here.

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
  @Environment(\.colorScheme) private var colorScheme
  let entry: VeloqEntry
  let family: WidgetFamily

  private var size: LastActivitySize { family == .systemSmall ? .small : .medium }

  var body: some View {
    let palette = WidgetPalette.resolve(entry.snapshot, colorScheme)
    Group {
      if let latest = entry.snapshot?.latest,
        let content = LastActivityWidgetModel.content(entry.snapshot, size: size)
      {
        view(latest, content, palette)
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
  private func view(_ latest: WidgetLatest, _ content: LastActivityContent, _ palette: WidgetPalette)
    -> some View
  {
    let tint = Color(hex: latest.tintHex)
    if size == .small {
      lines(latest, content, palette, tint)
        .widgetPadding(WidgetTheme.Layout.gap + 4)
    } else {
      HStack(spacing: WidgetTheme.Layout.gap) {
        if content.showsRoute {
          RoutePreviewView(preview: latest.routePreview, tint: tint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        lines(latest, content, palette, tint)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .widgetPadding(.horizontal, WidgetTheme.Layout.padding)
      .widgetPadding(.vertical, WidgetTheme.Layout.gap + 4)
    }
  }

  /// The comparison and what it rests on, in the order they are read. A line with nothing to say
  /// is left out, and none of them truncates: a long one wraps, and where the family has no room
  /// for every line whole the lines read last give way, from `LastActivityWidgetModel.fallbacks`.
  /// Nothing here caps a line's count, because the choice reads each line's whole height.
  private func lines(
    _ latest: WidgetLatest, _ content: LastActivityContent, _ palette: WidgetPalette, _ tint: Color
  ) -> some View {
    let choices = LastActivityWidgetModel.fallbacks(content)
    return ViewThatFits(in: .vertical) {
      ForEach(0..<choices.count, id: \.self) { index in
        column(latest, choices[index], palette, tint)
      }
    }
  }

  private func column(
    _ latest: WidgetLatest, _ content: LastActivityContent, _ palette: WidgetPalette, _ tint: Color
  ) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      if let name = content.name {
        HStack(spacing: 4) {
          Text(name)
            .measuredText("activity name")
            .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
            .foregroundColor(tint)
          if latest.isPr == true {
            Circle().fill(palette.gold).frame(width: 6, height: 6)
          }
        }
      }
      if let label = content.heroLabel {
        Text(label)
          .measuredText("hero label")
          .font(.system(size: WidgetTheme.TypeScale.caption))
          .foregroundColor(palette.textSecondary)
      }
      if let hero = content.hero {
        Text(hero)
          .measuredText("hero")
          .font(.system(size: WidgetTheme.TypeScale.metric, weight: .semibold))
          .foregroundColor(palette.textPrimary)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
      if let detail = content.detail {
        captionLine("detail", detail, palette)
      }
      if !content.dots.isEmpty {
        AttemptDotsView(dots: content.dots, tint: tint, palette: palette)
          .padding(.top, 2)
      }
      if let figures = content.figures {
        captionLine("figures", figures, palette)
      }
      if let prs = content.sectionPrs {
        captionLine("section records", prs, palette)
      }
      if let load = content.load {
        Text(load)
          .measuredText("load")
          .font(.system(size: WidgetTheme.TypeScale.label))
          .foregroundColor(palette.textPrimary)
      }
      if let form = content.form {
        formLine(form, palette)
      }
      if let date = content.date {
        captionLine("date", date, palette)
      }
      DemoLabelLine(snapshot: entry.snapshot, palette: palette)
    }
  }

  private func captionLine(_ name: String, _ text: String, _ palette: WidgetPalette) -> some View {
    Text(text)
      .measuredText(name)
      .font(.system(size: WidgetTheme.TypeScale.label))
      .foregroundColor(palette.textSecondary)
  }

  /// Form before and after, each side in the colour of the zone it sits in. The figures keep their
  /// width and a long word for form wraps beside them.
  private func formLine(_ form: LastActivityForm, _ palette: WidgetPalette) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text(form.label).measuredText("form label").foregroundColor(palette.textSecondary)
      Group {
        Text(form.before).fontWeight(.semibold).measuredText("form before")
          .foregroundColor(palette.formTextColor(form.beforeZone))
        Text(verbatim: "→").measuredText("form arrow").foregroundColor(palette.textSecondary)
        Text(form.after).fontWeight(.semibold).measuredText("form after")
          .foregroundColor(palette.formTextColor(form.afterZone))
      }
      .fixedSize()
    }
    .font(.system(size: WidgetTheme.TypeScale.label))
  }

  private func activityURL(_ latest: WidgetLatest) -> URL? {
    guard let id = latest.activityId, !id.isEmpty else { return URL(string: "veloq://") }
    return URL(string: "veloq://activity/\(id)")
  }
}

/// Every attempt at the route as a dot, oldest first. An earlier attempt is a small dot, the record
/// a gold one and the latest the full size in the activity's colour, ringed when it is also the
/// record. The row shrinks until all of them fit the width.
struct AttemptDotsView: View {
  let dots: [LastActivityDot]
  let tint: Color
  let palette: WidgetPalette

  private let rowHeight: CGFloat = 10
  private let gapRatio: CGFloat = 0.6

  var body: some View {
    GeometryReader { proxy in
      let count = CGFloat(max(dots.count, 1))
      let full = min(rowHeight, proxy.size.width / (count + (count - 1) * gapRatio))
      HStack(spacing: full * gapRatio) {
        ForEach(0..<dots.count, id: \.self) { index in
          dot(dots[index], full: full)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(height: rowHeight)
  }

  @ViewBuilder
  private func dot(_ dot: LastActivityDot, full: CGFloat) -> some View {
    let diameter = dot.current || dot.record ? full : full * 0.7
    Circle()
      .fill(dot.record ? palette.gold : dot.current ? tint : palette.textSecondary)
      .overlay {
        if dot.current && dot.record {
          Circle().strokeBorder(tint, lineWidth: full * 0.18)
        }
      }
      .frame(width: diameter, height: diameter)
      .frame(width: full, height: full)
  }
}

/// The words that say the numbers come from the sample library, and nothing at
/// all for the athlete's own.
struct DemoLabelLine: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  var body: some View {
    if let label = snapshot?.display.demoLabel {
      Text(label)
        .measuredText("demo label")
        .font(.system(size: WidgetTheme.TypeScale.caption))
        .foregroundColor(palette.textSecondary)
        .lineLimit(1)
    }
  }
}

struct VeloqLatestActivityWidget: Widget {
  let kind = "VeloqLatestActivityWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: LatestActivityProvider()) { entry in
      WidgetFamilyReader { LatestActivityView(entry: entry, family: $0) }
    }
    .configurationDisplayName("Latest Activity")
    .description("Your most recent activity with its route.")
    .supportedFamilies([.systemMedium, .systemSmall])
  }
}
