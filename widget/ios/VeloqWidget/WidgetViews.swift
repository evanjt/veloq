import SwiftUI
import WidgetKit

// Resolved palette the views render from. Dynamic colours come from the snapshot's
// theme block (picked by colour scheme); the generated WidgetTheme is the placeholder
// before any snapshot exists and the fallback for fields an older snapshot lacks.
// No colour is hand-typed here.
struct WidgetPalette {
  var background: Color
  var surface: Color
  var textPrimary: Color
  var textSecondary: Color
  var primary: Color
  var gold: Color
  var blue: Color
  var fatigue: Color
  var chartFitness: Color
  var chartFatigue: Color
  var formHighRisk: Color
  var formOptimal: Color
  var formGreyZone: Color
  var formFresh: Color
  var formTransition: Color
  var trendUp: Color
  var trendDown: Color
  var trendFlat: Color
  var warning: Color
  var toneNegative: Color
  var toneCaution: Color
  var tonePositive: Color
  var toneNeutral: Color
  var toneRecord: Color
  var toneInfo: Color
  var toneOpportunity: Color
  var border: Color
  var bodyFill: Color
  /// The strength shades, lightest first.
  var strengthRamp: [Color]

  static func from(_ d: WidgetPaletteData, fallback f: WidgetPalette) -> WidgetPalette {
    WidgetPalette(
      background: Color(hex: d.background),
      surface: Color(hex: d.surface),
      textPrimary: Color(hex: d.textPrimary),
      textSecondary: Color(hex: d.textSecondary),
      primary: Color(hex: d.primary),
      gold: Color(hex: d.gold),
      blue: Color(hex: d.blue),
      fatigue: d.fatigue.map { Color(hex: $0) } ?? f.fatigue,
      chartFitness: d.chartFitness.map { Color(hex: $0) } ?? f.chartFitness,
      chartFatigue: d.chartFatigue.map { Color(hex: $0) } ?? f.chartFatigue,
      formHighRisk: d.formHighRisk.map { Color(hex: $0) } ?? f.formHighRisk,
      formOptimal: d.formOptimal.map { Color(hex: $0) } ?? f.formOptimal,
      formGreyZone: d.formGreyZone.map { Color(hex: $0) } ?? f.formGreyZone,
      formFresh: d.formFresh.map { Color(hex: $0) } ?? f.formFresh,
      formTransition: d.formTransition.map { Color(hex: $0) } ?? f.formTransition,
      trendUp: Color(hex: d.trendUp),
      trendDown: Color(hex: d.trendDown),
      trendFlat: Color(hex: d.trendFlat),
      warning: d.warning.map { Color(hex: $0) } ?? f.warning,
      toneNegative: d.toneNegative.map { Color(hex: $0) } ?? f.toneNegative,
      toneCaution: d.toneCaution.map { Color(hex: $0) } ?? f.toneCaution,
      tonePositive: d.tonePositive.map { Color(hex: $0) } ?? f.tonePositive,
      toneNeutral: d.toneNeutral.map { Color(hex: $0) } ?? f.toneNeutral,
      toneRecord: d.toneRecord.map { Color(hex: $0) } ?? f.toneRecord,
      toneInfo: d.toneInfo.map { Color(hex: $0) } ?? f.toneInfo,
      toneOpportunity: d.toneOpportunity.map { Color(hex: $0) } ?? f.toneOpportunity,
      border: Color(hex: d.border),
      bodyFill: d.bodyFill.map { Color(hex: $0) } ?? f.bodyFill,
      strengthRamp: d.strengthRamp.flatMap { $0.isEmpty ? nil : $0.map { Color(hex: $0) } }
        ?? f.strengthRamp
    )
  }

  static func resolve(_ snapshot: WidgetSnapshot?, _ scheme: ColorScheme) -> WidgetPalette {
    let fallback = scheme == .dark ? darkFallback : lightFallback
    if let theme = snapshot?.theme, let data = scheme == .dark ? theme.dark : theme.light {
      return from(data, fallback: fallback)
    }
    return fallback
  }

  /// The key dot beside a summary entry's value, in its measure's colour: the fitness blue, the
  /// fatigue purple or the fill of the zone form sits in. The value itself is primary text. An
  /// entry with no measure colour, or a form zone this build does not know, draws no dot.
  func keyColor(_ colorKey: String, formZone: String?) -> Color? {
    switch colorKey {
    case "blue": return blue
    case "fatigue": return fatigue
    case "formZone": return formZone.flatMap(zoneFill)
    default: return nil
    }
  }

  /// The fill of a form zone, or nil for a zone this build does not know.
  func zoneFill(_ zone: String) -> Color? {
    switch zone {
    case "highRisk": return formHighRisk
    case "optimal": return formOptimal
    case "greyZone": return formGreyZone
    case "fresh": return formFresh
    case "transition": return formTransition
    default: return nil
    }
  }

  static let lightFallback = WidgetPalette(
    background: WidgetTheme.Light.background, surface: WidgetTheme.Light.surface,
    textPrimary: WidgetTheme.Light.textPrimary, textSecondary: WidgetTheme.Light.textSecondary,
    primary: WidgetTheme.Light.primary, gold: WidgetTheme.Light.gold, blue: WidgetTheme.Light.blue,
    fatigue: WidgetTheme.Light.fatigue,
    chartFitness: WidgetTheme.Light.chartFitness, chartFatigue: WidgetTheme.Light.chartFatigue,
    formHighRisk: WidgetTheme.Light.formHighRisk, formOptimal: WidgetTheme.Light.formOptimal,
    formGreyZone: WidgetTheme.Light.formGreyZone, formFresh: WidgetTheme.Light.formFresh,
    formTransition: WidgetTheme.Light.formTransition,
    trendUp: WidgetTheme.Light.trendUp, trendDown: WidgetTheme.Light.trendDown,
    trendFlat: WidgetTheme.Light.trendFlat, warning: WidgetTheme.Light.warning,
    toneNegative: WidgetTheme.Light.toneNegative, toneCaution: WidgetTheme.Light.toneCaution,
    tonePositive: WidgetTheme.Light.tonePositive, toneNeutral: WidgetTheme.Light.toneNeutral,
    toneRecord: WidgetTheme.Light.toneRecord, toneInfo: WidgetTheme.Light.toneInfo,
    toneOpportunity: WidgetTheme.Light.toneOpportunity,
    border: WidgetTheme.Light.border,
    bodyFill: WidgetTheme.Light.bodyFill, strengthRamp: WidgetTheme.Light.strengthRamp)

  static let darkFallback = WidgetPalette(
    background: WidgetTheme.Dark.background, surface: WidgetTheme.Dark.surface,
    textPrimary: WidgetTheme.Dark.textPrimary, textSecondary: WidgetTheme.Dark.textSecondary,
    primary: WidgetTheme.Dark.primary, gold: WidgetTheme.Dark.gold, blue: WidgetTheme.Dark.blue,
    fatigue: WidgetTheme.Dark.fatigue,
    chartFitness: WidgetTheme.Dark.chartFitness, chartFatigue: WidgetTheme.Dark.chartFatigue,
    formHighRisk: WidgetTheme.Dark.formHighRisk, formOptimal: WidgetTheme.Dark.formOptimal,
    formGreyZone: WidgetTheme.Dark.formGreyZone, formFresh: WidgetTheme.Dark.formFresh,
    formTransition: WidgetTheme.Dark.formTransition,
    trendUp: WidgetTheme.Dark.trendUp, trendDown: WidgetTheme.Dark.trendDown,
    trendFlat: WidgetTheme.Dark.trendFlat, warning: WidgetTheme.Dark.warning,
    toneNegative: WidgetTheme.Dark.toneNegative, toneCaution: WidgetTheme.Dark.toneCaution,
    tonePositive: WidgetTheme.Dark.tonePositive, toneNeutral: WidgetTheme.Dark.toneNeutral,
    toneRecord: WidgetTheme.Dark.toneRecord, toneInfo: WidgetTheme.Dark.toneInfo,
    toneOpportunity: WidgetTheme.Dark.toneOpportunity,
    border: WidgetTheme.Dark.border,
    bodyFill: WidgetTheme.Dark.bodyFill, strengthRamp: WidgetTheme.Dark.strengthRamp)
}

// MARK: - formatting helpers

/// The arrow the engine's trend glyph names, the one the app draws beside the same number: an
/// improvement points up and a decline down whichever way the number went, and a metric with no
/// polarity points the way it moved. Its variant follows the judgement the app made: filled for a
/// change judged better, outlined for one judged worse, bare when flat or unjudged. Flat is drawn as a right arrow rather than left blank,
/// and a direction this build does not know draws flat. A Home Screen that draws the widget in one
/// colour keeps the variant and loses the colour.
func trendSymbol(_ dir: String, _ verdict: String?) -> String {
  let arrow: String
  switch dir {
  case "up": arrow = "arrow.up"
  case "down": arrow = "arrow.down"
  default: arrow = "arrow.right"
  }
  switch verdict {
  case "improved": return arrow + ".circle.fill"
  case "declined": return arrow + ".circle"
  default: return arrow
  }
}

/// Coloured by the judgement the app made, never by the direction the number went, as a second
/// carrier beside the symbol's variant. A snapshot written before verdicts existed carries none
/// and draws flat.
func trendColor(_ verdict: String?, _ p: WidgetPalette) -> Color {
  switch verdict {
  case "improved": return p.trendUp
  case "declined": return p.trendDown
  default: return p.trendFlat
  }
}

// MARK: - trend chart (mirrors the in-app feed summary-card sparkline)

// Plot geometry shared by the chart views: a left gutter for axis value labels,
// a y domain buffered like the feed chart (so a line at the extremes
// isn't clipped), and room for the form zone bar at the bottom.
private struct ChartPlot {
  let left: CGFloat
  let top: CGFloat
  let right: CGFloat
  let bottom: CGFloat
  let domainMin: Double
  let domainMax: Double
  let rawMin: Double
  let rawMax: Double

  /// The axis labels' size, which sets the gutter they stand in.
  let axisFontSize: CGFloat

  init(size: CGSize, rawMin: Double, rawMax: Double, axisFontSize: CGFloat) {
    self.rawMin = rawMin
    self.rawMax = rawMax
    self.axisFontSize = axisFontSize
    let minLabel = String(Int(rawMin.rounded()))
    let maxLabel = String(Int(rawMax.rounded()))
    let chars = CGFloat(max(minLabel.count, maxLabel.count))
    left = chars * (axisFontSize * 0.62) + 4
    top = 2
    right = size.width - 2
    bottom = size.height - 2
    let range = rawMax - rawMin > 0 ? rawMax - rawMin : 1
    domainMin = rawMin - range * 0.06
    domainMax = rawMax + range * 0.04
  }

  func yOf(_ v: Double) -> CGFloat {
    top + CGFloat(1 - (v - domainMin) / (domainMax - domainMin)) * (bottom - top)
  }

  func xPositions(_ n: Int) -> [CGFloat] {
    let step = (right - left) / CGFloat(n - 1)
    return (0..<n).map { left + CGFloat($0) * step }
  }
}

// d3-shape curveMonotoneX port, so the widget curve matches the in-app chart.
private func monotonePath(xs: [CGFloat], ys: [CGFloat]) -> Path {
  func sgn(_ x: Double) -> Double { x < 0 ? -1 : 1 }
  func slope3(_ i0: Int, _ i1: Int, _ i2: Int) -> Double {
    let h0 = Double(xs[i1] - xs[i0])
    let h1 = Double(xs[i2] - xs[i1])
    let s0 = Double(ys[i1] - ys[i0]) / (h0 != 0 ? h0 : .leastNonzeroMagnitude)
    let s1 = Double(ys[i2] - ys[i1]) / (h1 != 0 ? h1 : .leastNonzeroMagnitude)
    let p = (s0 * h1 + s1 * h0) / (h0 + h1)
    let m = (sgn(s0) + sgn(s1)) * min(abs(s0), abs(s1), 0.5 * abs(p))
    return m.isFinite ? m : 0
  }
  func slope2(_ i0: Int, _ i1: Int, _ t: Double) -> Double {
    let h = Double(xs[i1] - xs[i0])
    return h != 0 ? (3 * Double(ys[i1] - ys[i0]) / h - t) / 2 : t
  }

  var path = Path()
  let n = xs.count
  path.move(to: CGPoint(x: xs[0], y: ys[0]))
  if n == 2 {
    path.addLine(to: CGPoint(x: xs[1], y: ys[1]))
    return path
  }
  func bezier(_ i0: Int, _ i1: Int, _ t0: Double, _ t1: Double) {
    let dx = Double(xs[i1] - xs[i0]) / 3
    path.addCurve(
      to: CGPoint(x: xs[i1], y: ys[i1]),
      control1: CGPoint(x: Double(xs[i0]) + dx, y: Double(ys[i0]) + dx * t0),
      control2: CGPoint(x: Double(xs[i1]) - dx, y: Double(ys[i1]) - dx * t1))
  }
  var t0: Double = 0
  for i in 2..<n {
    let t1 = slope3(i - 2, i - 1, i)
    bezier(i - 2, i - 1, i == 2 ? slope2(0, 1, t1) : t0, t1)
    t0 = t1
  }
  bezier(n - 2, n - 1, t0, slope2(n - 2, n - 1, t0))
  return path
}

// One chart line, dashed when it must read apart from a solid one without its colour. A line
// holds 3:1 on its own, so it draws no casing under it.
private struct ChartLine: View {
  let values: [Double]
  let plot: ChartPlot
  let color: Color
  let lineWidth: CGFloat
  var dash: [CGFloat] = []

  var body: some View {
    let xs = plot.xPositions(values.count)
    let ys = values.map { plot.yOf($0) }
    monotonePath(xs: xs, ys: ys).stroke(
      color,
      style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round, dash: dash))
  }
}

// Axis rail: gridlines at the series min/max with their values in the left gutter. The top value
// is held half a line from the top, so a chart with less than a line between that and its
// bottom draws the gridlines alone, since the values would overlap or stand above the chart.
private struct ChartAxis: View {
  let plot: ChartPlot
  let palette: WidgetPalette

  var body: some View {
    let marks = plot.rawMax > plot.rawMin ? [plot.rawMax, plot.rawMin] : [plot.rawMax]
    let labelled = plot.bottom >= plot.axisFontSize * 1.6
    ForEach(marks.indices, id: \.self) { i in
      let value = marks[i]
      let y = plot.yOf(value)
      Path { p in
        p.move(to: CGPoint(x: plot.left, y: y))
        p.addLine(to: CGPoint(x: plot.right, y: y))
      }
      .stroke(palette.border, lineWidth: 0.5)
      if labelled {
        Text(String(Int(value.rounded())))
          .measuredText("axis value")
          .widgetFont(size: plot.axisFontSize)
          .foregroundColor(palette.textSecondary)
          // Held half a line from the top, so the top label stays inside the chart.
          .position(x: (plot.left - 4) / 2, y: min(max(y, plot.axisFontSize * 0.6), plot.bottom))
      }
    }
  }
}

// Feed-style chart: monotone fitness + fatigue lines over a shared domain, and
// the axis rail. Fatigue is dashed, so the two lines read apart without their
// colours, and fitness is the accented one. Display-only (no link).
struct FitnessChartView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette
  @ScaledMetric(relativeTo: WidgetTheme.TypeStep.caption.style)
  private var axisScaled = WidgetTheme.TypeStep.caption.size
  private var axisFontSize: CGFloat { WidgetTheme.TypeStep.caption.capped(axisScaled) }

  var body: some View {
    GeometryReader { geo in
      let fitness = snapshot?.sparklines.fitness ?? []
      let fatigue = snapshot?.sparklines.fatigue ?? []
      let all = fitness + fatigue
      if fitness.count >= 2, let rawMin = all.min(), let rawMax = all.max() {
        let plot = ChartPlot(
          size: geo.size, rawMin: rawMin, rawMax: rawMax, axisFontSize: axisFontSize)
        ChartAxis(plot: plot, palette: palette)
        if fatigue.count >= 2 {
          ChartLine(
            values: fatigue, plot: plot, color: palette.chartFatigue, lineWidth: 1,
            dash: WidgetTheme.Chart.fatigueDash)
        }
        ChartLine(values: fitness, plot: plot, color: palette.chartFitness, lineWidth: 1.5)
        .widgetAccentable()
      }
    }
  }
}

// Single-series variant (HRV): one line with a faint fill, same axis rail.
struct SingleTrendChart: View {
  let values: [Double]
  let color: Color
  let palette: WidgetPalette
  @ScaledMetric(relativeTo: WidgetTheme.TypeStep.caption.style)
  private var axisScaled = WidgetTheme.TypeStep.caption.size
  private var axisFontSize: CGFloat { WidgetTheme.TypeStep.caption.capped(axisScaled) }

  var body: some View {
    GeometryReader { geo in
      if values.count >= 2, let rawMin = values.min(), let rawMax = values.max() {
        let plot = ChartPlot(
          size: geo.size, rawMin: rawMin, rawMax: rawMax, axisFontSize: axisFontSize)
        ChartAxis(plot: plot, palette: palette)
        FillPath(values: values, plot: plot, color: color)
        ChartLine(values: values, plot: plot, color: color, lineWidth: 1.5)
      }
    }
  }
}

private struct FillPath: View {
  let values: [Double]
  let plot: ChartPlot
  let color: Color

  var body: some View {
    let xs = plot.xPositions(values.count)
    let ys = values.map { plot.yOf($0) }
    var path = monotonePath(xs: xs, ys: ys)
    path.addLine(to: CGPoint(x: xs[xs.count - 1], y: plot.bottom))
    path.addLine(to: CGPoint(x: xs[0], y: plot.bottom))
    path.closeSubpath()
    return path.fill(color.opacity(0.15))
  }
}

// Shown before the app has ever written a snapshot (fresh install, before the first
// background write) so medium/large widgets aren't a blank coloured rectangle. The
// strings are hardcoded English like the metric-label fallbacks above; no snapshot
// means no localized `display` block to read.
struct EmptyWidgetView: View {
  let palette: WidgetPalette

  var body: some View {
    VStack(spacing: 4) {
      Image(systemName: "chart.line.uptrend.xyaxis")
        .widgetFont(.metric, weight: .semibold)
        .foregroundColor(palette.primary)
        .unspoken()
      Text("Open Veloq")
        .measuredText("empty title")
        .widgetProseFont(.value, weight: .semibold, shrinks: true)
        .foregroundColor(palette.textPrimary)
      Text("to see your training")
        .measuredText("empty subtitle")
        .widgetProseFont(.label, shrinks: true)
        .foregroundColor(palette.textSecondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .widgetPadding(WidgetTheme.Layout.padding)
  }
}

/**
 * When the numbers on a snapshot count as old.
 *
 * Past this the age line turns amber and names the time instead of counting up
 * from it, so a widget the app has not refreshed for a day cannot read as
 * current. The same limit is `SnapshotAge.STALE_AFTER_SECONDS` on Android.
 */
enum SnapshotAge {
  static let staleAfter: TimeInterval = 24 * 60 * 60

  /// Past the limit, strictly: a snapshot exactly a day old is not yet stale.
  static func isStale(since seconds: Double, now: Date) -> Bool {
    seconds > 0 && now.timeIntervalSince1970 - seconds > staleAfter
  }

  /// The instant the age line should be judged from: the sync the numbers came
  /// from where the snapshot names one, else when the snapshot was written. A
  /// snapshot with a label and no sync time has no instant, and stays unjudged.
  static func reference(_ snapshot: WidgetSnapshot?) -> Double? {
    guard let snapshot = snapshot, snapshot.display.demoLabel == nil else { return nil }
    if snapshot.display.dataAsOfLabel != nil {
      return snapshot.dataAsOf.flatMap { $0 > 0 ? $0 : nil }
    }
    return snapshot.generatedAt > 0 ? snapshot.generatedAt : nil
  }

  /// How far back the fresh age line counts: now under a minute, then whole
  /// minutes under an hour and whole hours after. It never counts seconds, and
  /// never says "0 minutes ago". The same rule is `SnapshotAge.span` on Android.
  enum Span: Equatable {
    case now
    case minutes(Int)
    case hours(Int)
  }

  /// The fresh age line's span. A snapshot from the future reads as just written.
  static func span(since seconds: Double, now: Date) -> Span {
    let minutes = Int(max(0, now.timeIntervalSince1970 - seconds) / 60)
    if minutes < 1 { return .now }
    if minutes < 60 { return .minutes(minutes) }
    return .hours(minutes / 60)
  }

  /// "now" or "5 min. ago" in the system's short relative phrasing, the
  /// wording `RelativeDateTimeFormatter.Style.SHORT` gives on Android.
  static func text(_ span: Span, locale: Locale) -> String {
    let formatter = RelativeDateTimeFormatter()
    formatter.locale = locale
    formatter.unitsStyle = .short
    switch span {
    case .now:
      formatter.dateTimeStyle = .named
      return formatter.localizedString(from: DateComponents(second: 0))
    case .minutes(let count):
      return formatter.localizedString(from: DateComponents(minute: -count))
    case .hours(let count):
      return formatter.localizedString(from: DateComponents(hour: -count))
    }
  }

  /// Every moment strictly between `start` and `end` at which the age line's
  /// words change: each minute of the first hour, each hour after, and the
  /// moment the snapshot turns stale. The timeline carries an entry at each,
  /// so the line moves on between reloads without counting seconds.
  static func changes(_ snapshot: WidgetSnapshot?, after start: Date, before end: Date) -> [Date] {
    guard let seconds = reference(snapshot) else { return [] }
    let minutes = (1..<60).map { seconds + Double($0) * 60 }
    let hours = (1...Int(staleAfter / 3600)).map { seconds + Double($0) * 3600 }
    return (minutes + hours + [seconds + staleAfter + 1])
      .map { Date(timeIntervalSince1970: $0) }
      .filter { $0 > start && $0 < end }
  }
}

private struct SnapshotNowKey: EnvironmentKey {
  static let defaultValue: Date? = nil
}

extension EnvironmentValues {
  /// The date of the timeline entry being drawn. WidgetKit draws an entry ahead
  /// of its date, so the age line is judged against this and not the clock.
  var snapshotNow: Date? {
    get { self[SnapshotNowKey.self] }
    set { self[SnapshotNowKey.self] = newValue }
  }
}

/**
 * How old the numbers on the widget are.
 *
 * The widget is stale exactly for the athlete whose app has not run, and the
 * numbers give no clue how old they are. The line says now, then minutes ago,
 * then hours ago, judged against the timeline entry being drawn, and the
 * timeline carries an entry at each change (`SnapshotAge.changes`), so the line
 * stays honest between refreshes without counting seconds. Past
 * `SnapshotAge.staleAfter` the line is amber and names the time.
 *
 * A snapshot the app wrote shows when it was written. A snapshot a background
 * refresh redrew from stored rows, because its pull did not land, carries the
 * words "as of the last sync" and the time of that sync, since the time of the
 * redraw would say the numbers are current. With no sync time known, the words
 * stand alone.
 *
 * A snapshot from before the field carries zero and shows nothing rather than
 * a date in 1970.
 */
struct SnapshotAgeLine: View {
  @Environment(\.snapshotNow) private var snapshotNow
  @Environment(\.locale) private var locale
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  private func when(_ seconds: Double) -> some View {
    let now = snapshotNow ?? Date()
    return Group {
      if SnapshotAge.isStale(since: seconds, now: now) {
        Text(
          Date(timeIntervalSince1970: seconds),
          format: .dateTime.month(.abbreviated).day().hour().minute()
        )
        .measuredText("age")
        .foregroundColor(palette.warning)
      } else {
        Text(verbatim: SnapshotAge.text(SnapshotAge.span(since: seconds, now: now), locale: locale))
          .measuredText("age")
      }
    }
  }

  var body: some View {
    if let demo = snapshot?.display.demoLabel {
      // The sample library is composed afresh for every write, so it has no age
      // to report and the line carries the words that say it is not the
      // athlete's own.
      Text(demo).measuredText("demo label").modifier(AgeLineStyle(palette: palette))
    } else if let label = snapshot?.display.dataAsOfLabel {
      if let seconds = snapshot?.dataAsOf, seconds > 0 {
        HStack(spacing: 0) {
          Text(label)
            .measuredText("age label")
          Text(verbatim: " · ")
            .measuredText("age separator")
          when(seconds)
        }
        .modifier(AgeLineStyle(palette: palette))
      } else {
        Text(label).measuredText("age label").modifier(AgeLineStyle(palette: palette))
      }
    } else if let seconds = snapshot?.generatedAt, seconds > 0 {
      when(seconds).modifier(AgeLineStyle(palette: palette))
    }
  }
}

/// A caption on one line, fitted to the column down to the floor: a stale date with a 12-hour
/// clock is wider than a small widget at the largest text sizes.
private struct AgeLineStyle: ViewModifier {
  let palette: WidgetPalette

  func body(content: Content) -> some View {
    content
      .widgetFont(.caption, shrinks: true)
      .foregroundColor(palette.textSecondary)
      .lineLimit(1)
  }
}

// MARK: - Summary widget

extension WidgetPalette {
  /// The fill of a form zone's band on the large chart.
  func formFill(_ zone: String) -> Color {
    zoneFill(zone) ?? formTransition
  }
}

/// The dot beside a value that says which measure it is in that measure's colour, so the value
/// stays primary text. The value's own words say what it is, so the dot is not spoken.
struct KeyDot: View {
  let color: Color

  var body: some View {
    Circle().fill(color).frame(width: 6, height: 6)
      .unspoken()
  }
}

/// The in-app summary card at one size: the hero with its line and chart, the supporting row,
/// and at Large six weeks of form over its zones. The latest activity and its impact belong to
/// the Last activity widget and are not drawn here.
struct SummaryWidgetView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette
  let size: SummarySize
  let placement: SummaryPlacement

  var body: some View {
    if let snapshot, !WidgetSnapshot.isEmpty(snapshot) {
      let content = SummaryWidgetModel.content(snapshot, placement: placement, size: size)
      let formZone = snapshot.metrics.form.zone
      switch size {
      case .small:
        VStack(alignment: .leading, spacing: 2) {
          SummaryHero(
            content: content, palette: palette, formZone: formZone,
            valueStep: .hero)
          Spacer(minLength: 2)
          SummaryChartView(kind: content.chart, snapshot: snapshot, palette: palette)
            .frame(height: 40)
          SnapshotAgeLine(snapshot: snapshot, palette: palette)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetPadding(WidgetTheme.Layout.padding)
      case .medium, .large:
        card(content, snapshot, formZone)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .widgetPadding(WidgetTheme.Layout.padding)
      }
    } else {
      EmptyWidgetView(palette: palette)
    }
  }

  /// The medium and large card: the hero beside its chart, or at Large the hero with the rest of
  /// training load on its line and the chart across the card under them, then the supporting row,
  /// at Large the form chart, and the age row. A medium box has no height for a second line under
  /// the age, so there the refresh link stays beside it.
  private func card(
    _ content: SummaryContent, _ snapshot: WidgetSnapshot, _ formZone: String?
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if size == .large {
        HStack(alignment: .top, spacing: WidgetTheme.Layout.gap) {
          SummaryHero(
            content: content, palette: palette, formZone: formZone,
            valueStep: .metric)
          ForEach(content.trainingLoad, id: \.entry.id) { reading in
            SummaryLoadReading(reading: reading, palette: palette, formZone: formZone)
          }
          Spacer(minLength: 0)
        }
        chart(content, snapshot)
          .frame(height: 56)
      } else {
        HStack(alignment: .top, spacing: WidgetTheme.Layout.gap) {
          SummaryHero(
            content: content, palette: palette, formZone: formZone,
            valueStep: .metric)
            .frame(maxWidth: .infinity, alignment: .leading)
          chart(content, snapshot)
            .frame(height: 48)
        }
      }
      Divider().background(palette.border)
      // With no form chart under it the row takes the height left, which costs no second gap
      // as a spacer would.
      SummarySupportingRow(
        entries: content.supporting, palette: palette, formZone: formZone)
        .frame(maxHeight: content.formZones == nil ? .infinity : nil, alignment: .top)
      if let zones = content.formZones {
        Divider().background(palette.border)
        VStack(alignment: .leading, spacing: 2) {
          if let caption = content.formCaption {
            FormCaptionRow(caption: caption, palette: palette)
          }
          FormZoneChartView(chart: zones, palette: palette)
            .frame(maxHeight: .infinity)
        }
        .spoken("form chart", snapshot.display.chartLabels?.form)
        .frame(maxHeight: .infinity)
      }
      HStack(spacing: 4) {
        SnapshotAgeRow(
          snapshot: snapshot, palette: palette, hasRoom: true, oneLine: size == .medium)
        if let record = content.record {
          Spacer(minLength: 0)
          SummaryRecordButton(url: record, label: snapshot.display.recordLabel)
        }
      }
    }
  }

  /// The hero's chart with its legend, as wide as the card leaves it.
  private func chart(_ content: SummaryContent, _ snapshot: WidgetSnapshot) -> some View {
    SummaryChartView(
      kind: content.chart, caption: content.chartCaption, snapshot: snapshot, palette: palette
    )
    .frame(maxWidth: .infinity)
  }
}

/// The record button at the end of the age row: the record glyph in the recording tone, opening
/// recording on the sport the link names.
private struct SummaryRecordButton: View {
  @Environment(\.colorScheme) private var colorScheme
  let url: URL
  let label: String?

  /// The glyph, drawn over the caption's line and inside the 44 point target.
  private let glyph: CGFloat = 16

  var body: some View {
    let tone = WidgetTheme.Record.accent(colorScheme)
    Link(destination: url) {
      ZStack {
        Circle().stroke(tone, lineWidth: 2)
        Circle().fill(tone).padding(4)
      }
      .frame(width: glyph, height: glyph)
      .widgetAccentable()
      .frame(minWidth: WidgetRefreshLink.target, minHeight: WidgetRefreshLink.target)
      .contentShape(Rectangle())
      .spoken("record button", label)
    }
    // The target stays 44 points tall while the row keeps the height of its caption, as the
    // refresh control's does.
    .padding(.vertical, -(WidgetRefreshLink.target - WidgetTheme.TypeScale.caption) / 2)
  }
}

private struct SummaryHero: View {
  let content: SummaryContent
  let palette: WidgetPalette
  let formZone: String?
  let valueStep: WidgetTheme.TypeStep

  var body: some View {
    let hero = content.hero
    let key = palette.keyColor(hero.colorKey, formZone: formZone)
    VStack(alignment: .leading, spacing: 2) {
      VStack(alignment: .leading, spacing: 2) {
        Text(hero.label.uppercased())
          .measuredText("hero label")
          .widgetFont(.label, shrinks: true)
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
        HStack(spacing: 4) {
          if let key {
            KeyDot(color: key)
          }
          Text(hero.value)
            .measuredText("hero value")
            .widgetFont(valueStep, weight: .bold, shrinks: true)
            .foregroundColor(palette.textPrimary)
            .lineLimit(1)
            .widgetAccentable()
          Image(systemName: trendSymbol(hero.trendDir, hero.verdict))
            .widgetFont(.label, weight: .bold)
            .foregroundColor(trendColor(hero.verdict, palette))
            .unspoken()
        }
      }
      .spoken("hero", hero.spoken, otherwise: .combine)
      if let line = content.heroLine, !line.isEmpty {
        Text(line)
          .measuredText("hero line")
          .widgetFont(.caption, weight: .semibold)
          .foregroundColor(palette.textPrimary)
          .lineLimit(1)
      }
    }
  }
}

/// One reading of training load on the hero's line: its label over its key dot and value, as a
/// supporting entry draws it, and Form's zone in words under it. A translated label wraps to a
/// second line rather than be cut short.
private struct SummaryLoadReading: View {
  let reading: SummarySupporting
  let palette: WidgetPalette
  let formZone: String?

  var body: some View {
    let entry = reading.entry
    VStack(alignment: .leading, spacing: 2) {
      VStack(alignment: .leading, spacing: 2) {
        Text(entry.label)
          .measuredText("load label")
          .widgetFont(.caption, shrinks: true)
          .foregroundColor(palette.textSecondary)
          .lineLimit(2)
        HStack(spacing: 3) {
          if let key = palette.keyColor(entry.colorKey, formZone: formZone) {
            KeyDot(color: key)
          }
          Text(entry.value)
            .measuredText("load value")
            .widgetFont(.value, weight: .semibold, shrinks: true)
            .foregroundColor(palette.textPrimary)
            .lineLimit(1)
        }
      }
      .spoken("metric", entry.spoken, otherwise: .combine)
      if let caption = reading.caption, !caption.isEmpty {
        Text(caption)
          .measuredText("metric caption")
          .widgetFont(.caption, weight: .semibold, shrinks: true)
          .foregroundColor(palette.textPrimary)
          .lineLimit(1)
      }
    }
  }
}

/// The chart under the hero: nothing when the placement or the card hides it, or when the
/// snapshot holds no series for it. A caption under it names its series and the days it spans,
/// inside the same height.
private struct SummaryChartView: View {
  let kind: SummaryChartKind
  var caption: ChartCaption? = nil
  let snapshot: WidgetSnapshot
  let palette: WidgetPalette

  /// The least height the lines are drawn in. A caption that leaves less, in long words or at a
  /// large text size, is drawn alone: it still names the series and the span.
  private let plotMinHeight: CGFloat = 16

  var body: some View {
    switch kind {
    case .none:
      EmptyView()
    case .fitnessForm:
      plotted(caption) {
        FitnessChartView(snapshot: snapshot, palette: palette)
      }
      .spoken("chart", snapshot.display.chartLabels?.fitness)
    case .hrv:
      plotted(caption) {
        SingleTrendChart(values: snapshot.sparklines.hrv, color: palette.primary, palette: palette)
      }
      .spoken("chart", snapshot.display.chartLabels?.hrv)
    }
  }

  @ViewBuilder
  private func plotted(_ caption: ChartCaption?, _ plot: () -> some View) -> some View {
    if let caption {
      ViewThatFits(in: .vertical) {
        VStack(alignment: .leading, spacing: 2) {
          plot().frame(minHeight: plotMinHeight)
          ChartCaptionRow(caption: caption, palette: palette)
        }
        ChartCaptionRow(caption: caption, palette: palette)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    } else {
      plot()
    }
  }
}

/// A short stroke drawn as a chart line is, dashed alike, so a legend entry reads as its line
/// without its colour.
private struct LegendStroke: View {
  let color: Color
  var dash: [CGFloat] = []

  var body: some View {
    Path { p in
      p.move(to: CGPoint(x: 1, y: 3))
      p.addLine(to: CGPoint(x: 11, y: 3))
    }
    .stroke(color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: dash))
    .frame(width: 12, height: 6)
  }
}

/// The chart's series, fitness solid and fatigue dashed as their lines are, and the days it spans:
/// on one line where it fits, else the span under the series, else each on a line of its own.
private struct ChartCaptionRow: View {
  let caption: ChartCaption
  let palette: WidgetPalette

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 6) {
        HStack(spacing: 6) { series }
        Spacer(minLength: 0)
        span
      }
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 6) { series }
        span
      }
      VStack(alignment: .leading, spacing: 1) {
        series
        span
      }
    }
  }

  private var series: some View {
    ForEach(Array(caption.series.enumerated()), id: \.offset) { index, name in
      HStack(spacing: 3) {
        if index == 0 {
          LegendStroke(color: palette.chartFitness)
            .widgetAccentable()
        } else {
          LegendStroke(color: palette.chartFatigue, dash: WidgetTheme.Chart.fatigueDash)
        }
        Text(name)
          .measuredText("chart series")
          .widgetFont(.caption, shrinks: true)
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
      }
    }
  }

  @ViewBuilder
  private var span: some View {
    if let span = caption.span, !span.isEmpty {
      Text(span)
        .measuredText("chart span")
        .widgetFont(.caption, shrinks: true)
        .foregroundColor(palette.textSecondary)
        .lineLimit(1)
    }
  }
}

/// The form chart's name, the zone today sits in and the days it spans, over the chart.
private struct FormCaptionRow: View {
  let caption: FormChartCaption
  let palette: WidgetPalette

  var body: some View {
    HStack(spacing: 6) {
      Text(caption.title.uppercased())
        .measuredText("form chart title")
        .widgetFont(.caption, shrinks: true)
        .foregroundColor(palette.textSecondary)
        .lineLimit(1)
      if let zone = caption.zone {
        Text(zone)
          .measuredText("form chart zone")
          .widgetFont(.caption, weight: .semibold, shrinks: true)
          .foregroundColor(palette.textPrimary)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
      if let span = caption.span, !span.isEmpty {
        Text(span)
          .measuredText("chart span")
          .widgetFont(.caption, shrinks: true)
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
      }
    }
  }
}

/// Up to four metrics side by side, split by dividers. The Form entry names its zone under its
/// value, which its key dot alone would carry.
private struct SummarySupportingRow: View {
  let entries: [SummarySupporting]
  let palette: WidgetPalette
  let formZone: String?

  var body: some View {
    let captioned = entries.contains { $0.caption?.isEmpty == false }
    HStack(spacing: 0) {
      ForEach(Array(entries.enumerated()), id: \.offset) { index, supporting in
        let entry = supporting.entry
        let key = palette.keyColor(entry.colorKey, formZone: formZone)
        if index > 0 {
          Divider().background(palette.border)
        }
        VStack(alignment: .leading, spacing: 2) {
          VStack(alignment: .leading, spacing: 2) {
            Text(entry.label)
              .measuredText("metric label")
              .widgetFont(.caption, shrinks: true)
              .foregroundColor(palette.textSecondary)
              .lineLimit(1)
            HStack(spacing: 3) {
              if let key {
                KeyDot(color: key)
              }
              Text(entry.value)
                .measuredText("metric value")
                .widgetFont(.value, weight: .semibold, shrinks: true)
                .foregroundColor(palette.textPrimary)
                .lineLimit(1)
              Image(systemName: trendSymbol(entry.trendDir, entry.verdict))
                .widgetFont(.caption, weight: .bold)
                .foregroundColor(trendColor(entry.verdict, palette))
                .unspoken()
            }
          }
          // The caption is the form zone in words, which the metric's spoken label leaves out,
          // so it stays a text of its own.
          .spoken("metric", entry.spoken, otherwise: .combine)
          if let caption = supporting.caption, !caption.isEmpty {
            Text(caption)
              .measuredText("metric caption")
              .widgetFont(.caption, weight: .semibold, shrinks: true)
              .foregroundColor(palette.textPrimary)
              .lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 6)
      }
    }
    .frame(
      height: captioned
        ? WidgetTheme.Layout.supportingRowCaptioned : WidgetTheme.Layout.supportingRow)
  }
}

private extension FormZoneChart {
  func y(_ value: Double, height: CGFloat) -> CGFloat {
    CGFloat((max - value) / (max - min)) * height
  }
}

/// Form over six weeks against its five zone bands, each bound labelled in the left gutter. A
/// day with no value breaks the line.
///
/// A line marks each boundary between two bands in every mode. Drawn in one colour the bands
/// would all take one tint at one alpha, so there they alternate between two alphas instead.
private struct FormZoneChartView: View {
  @Environment(\.widgetRenderingMode) private var renderingMode
  let chart: FormZoneChart
  let palette: WidgetPalette
  @ScaledMetric(relativeTo: WidgetTheme.TypeStep.caption.style)
  private var axisScaled = WidgetTheme.TypeStep.caption.size
  private var axisFontSize: CGFloat { WidgetTheme.TypeStep.caption.capped(axisScaled) }

  /// The four values where one zone meets the next, low to high.
  private var bounds: [Double] { chart.bands.dropFirst().map(\.from) }

  /// The gutter the bound labels stand in, sized as the hero chart's axis gutter is.
  private var gutter: CGFloat {
    let chars = bounds.map { String(Int($0.rounded())).count }.max() ?? 0
    return CGFloat(chars) * (axisFontSize * 0.62) + 4
  }

  private func bandOpacity(_ index: Int) -> Double {
    guard renderingMode == .accented else { return WidgetTheme.Chart.bandOpacity }
    let alphas = WidgetTheme.Chart.bandAccentedOpacities
    return alphas[index % alphas.count]
  }

  var body: some View {
    GeometryReader { geo in
      let left = gutter
      let width = max(geo.size.width - left, 1)
      let height = geo.size.height
      ZStack(alignment: .topLeading) {
        ForEach(Array(chart.bands.enumerated()), id: \.element.zone) { index, band in
          Rectangle()
            .fill(palette.formFill(band.zone).opacity(bandOpacity(index)))
            .frame(
              width: width,
              height: chart.y(band.from, height: height) - chart.y(band.to, height: height)
            )
            .offset(x: left, y: chart.y(band.to, height: height))
        }
        boundaries(left: left, width: width, height: height)
          .stroke(palette.textSecondary, lineWidth: WidgetTheme.Chart.bandBoundary)
        line(left: left, width: width, height: height)
          .stroke(
            palette.textPrimary,
            style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        ForEach(bounds.indices, id: \.self) { i in
          Text(String(Int(bounds[i].rounded())))
            .measuredText("zone bound")
            .widgetFont(size: axisFontSize)
            .foregroundColor(palette.textSecondary)
            .position(
              x: (left - 4) / 2,
              // Held half a line inside, so a bound near the floor or ceiling stays in the chart.
              y: min(
                max(chart.y(bounds[i], height: height), axisFontSize * 0.6),
                height - axisFontSize * 0.6))
        }
      }
    }
  }

  /// Every edge two bands share, which leaves out the chart's floor and ceiling.
  private func boundaries(left: CGFloat, width: CGFloat, height: CGFloat) -> Path {
    var path = Path()
    for bound in bounds {
      let y = chart.y(bound, height: height)
      path.move(to: CGPoint(x: left, y: y))
      path.addLine(to: CGPoint(x: left + width, y: y))
    }
    return path
  }

  private func line(left: CGFloat, width: CGFloat, height: CGFloat) -> Path {
    var path = Path()
    var open = false
    let last = max(chart.values.count - 1, 1)
    for (i, value) in chart.values.enumerated() {
      guard let value else {
        open = false
        continue
      }
      let point = CGPoint(
        x: left + width * CGFloat(i) / CGFloat(last), y: chart.y(value, height: height))
      if open {
        path.addLine(to: point)
      } else {
        path.move(to: point)
        open = true
      }
    }
    return path
  }
}
