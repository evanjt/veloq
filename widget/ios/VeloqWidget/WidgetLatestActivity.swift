import SwiftUI
import WidgetKit

// Last activity widget: how the most recent activity compared, with a native-drawn route outline
// of its track. It leads with the rank among the attempts at its route and the gap to the
// record, every attempt as a dot, or with no route its load against the typical one; below come
// the section records, the load and the form before and after. The whole widget deep-links into
// the activity detail screen. What each size draws is decided in LastActivityWidgetModel; all
// data comes from the shared snapshot and nothing is computed here.

struct LatestActivityProvider: TimelineProvider {
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
        .widgetFont(.metric, weight: .semibold)
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
            .spoken("route", latest.routeLabel)
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
  /// Nothing here caps a line's count, because the choice reads each line's whole height. Where
  /// not even the last fallback fits whole, at the accessibility text sizes, it is drawn once
  /// more with its prose fitted to the room left, down to the floor.
  private func lines(
    _ latest: WidgetLatest, _ content: LastActivityContent, _ palette: WidgetPalette, _ tint: Color
  ) -> some View {
    let choices = LastActivityWidgetModel.fallbacks(content)
    return ViewThatFits(in: .vertical) {
      ForEach(0..<choices.count, id: \.self) { index in
        column(latest, choices[index], palette, tint)
      }
      if let last = choices.last {
        column(latest, last, palette, tint, fitted: true)
      }
    }
  }

  private func column(
    _ latest: WidgetLatest, _ content: LastActivityContent, _ palette: WidgetPalette, _ tint: Color,
    fitted: Bool = false
  ) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      if let name = content.name {
        HStack(spacing: 4) {
          Text(name)
            .measuredText("activity name")
            .widgetProseFont(.label, weight: .semibold, shrinks: fitted)
            .foregroundColor(tint)
            // A name the column keeps takes every line it wraps to, as the lines under it do.
            .fixedSize(horizontal: false, vertical: !fitted)
          if latest.isPr == true {
            Circle().fill(palette.gold).frame(width: 6, height: 6)
              .widgetAccentable()
              .spoken("record", latest.prLabel)
          }
        }
      }
      if let label = content.heroLabel {
        Text(label)
          .measuredText("hero label")
          .widgetFont(.caption)
          .foregroundColor(palette.textSecondary)
      }
      if let hero = content.hero {
        Text(hero)
          .measuredText("hero")
          .widgetFont(.metric, weight: .semibold, shrinks: true)
          .foregroundColor(palette.textPrimary)
          .lineLimit(1)
      }
      if let detail = content.detail {
        captionLine("detail", detail, palette, prose: true, fitted: fitted)
      }
      if !content.dots.isEmpty {
        AttemptDotsView(dots: content.dots, tint: tint, palette: palette)
          .unspoken()
          .padding(.top, 2)
      }
      if let figures = content.figures {
        captionLine("figures", figures, palette)
      }
      if let prs = content.sectionPrs {
        captionLine("section records", prs, palette, prose: true, fitted: fitted)
      }
      if let load = content.load {
        Text(load)
          .measuredText("load")
          .widgetFont(.label)
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

  /// A line under the hero. A sentence is `prose` and follows the reader's text size however
  /// large; a run of figures stops at the cap. A `fitted` sentence shrinks to the room it is
  /// given rather than taking every line it wraps to.
  @ViewBuilder
  private func captionLine(
    _ name: String, _ text: String, _ palette: WidgetPalette, prose: Bool = false,
    fitted: Bool = false
  ) -> some View {
    let line = Text(text).measuredText(name)
    if prose && fitted {
      line.widgetProseFont(.label, shrinks: true).foregroundColor(palette.textSecondary)
    } else {
      Group {
        if prose { line.widgetProseFont(.label) } else { line.widgetFont(.label) }
      }
      .foregroundColor(palette.textSecondary)
      // The fallback this column is chosen from gives way a line at a time, so a line it keeps
      // takes every line it wraps to.
      .fixedSize(horizontal: false, vertical: true)
    }
  }

  /// Form before and after, each side in the colour of the zone it sits in, with the zones in
  /// words, so the line says the same where colour is lost: the zone form ended in, or both when
  /// the activity moved it from one to another. The words follow the figures on their row where
  /// they fit and go under them where they do not. The figures keep their width and a long word
  /// for form wraps beside them.
  private func formLine(_ form: LastActivityForm, _ palette: WidgetPalette) -> some View {
    let zone = form.afterZoneText.map { after in
      Text(verbatim: form.beforeZoneText.map { "\($0) → \(after)" } ?? after)
        .measuredText("form zone")
        .font(.system(size: WidgetTheme.TypeScale.caption))
        .foregroundColor(palette.textSecondary)
    }
    return ViewThatFits(in: .horizontal) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        formFigures(form, palette).fixedSize()
        zone?.fixedSize()
      }
      VStack(alignment: .leading, spacing: 0) {
        formFigures(form, palette)
        zone
      }
    }
  }

  private func formFigures(_ form: LastActivityForm, _ palette: WidgetPalette) -> some View {
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
    .widgetFont(.label)
  }

  private func activityURL(_ latest: WidgetLatest) -> URL? {
    guard let id = latest.activityId, !id.isEmpty else { return URL(string: "veloq://") }
    return URL(string: "veloq://activity/\(id)")
  }
}

/// Every attempt at the route as a dot, oldest first. An earlier attempt is a small dot, the record
/// a gold one and the latest the full size in the activity's colour, ringed when it is also the
/// record. The row shrinks until all of them fit the width.
///
/// The record takes the widget's accent while the other dots stay default, and the ring stands
/// clear of the dot it rings, so it still reads where both are drawn in one colour.
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
    Group {
      if dot.current && dot.record {
        ZStack {
          Circle().strokeBorder(tint, lineWidth: full * 0.15)
          Circle().fill(palette.gold).padding(full * 0.3)
        }
      } else {
        Circle().fill(dot.record ? palette.gold : dot.current ? tint : palette.textSecondary)
      }
    }
    .widgetAccentable(dot.record)
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
        .widgetFont(.caption)
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
        .snapshotLocale(entry.snapshot)
    }
    .configurationDisplayName("Latest Activity")
    .description("Your most recent activity with its route.")
    .supportedFamilies([.systemMedium, .systemSmall])
  }
}
