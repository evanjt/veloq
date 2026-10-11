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
  var chartCasing: Color
  var formHighRisk: Color
  var formOptimal: Color
  var formGreyZone: Color
  var formFresh: Color
  var formTransition: Color
  var formHighRiskText: Color
  var formOptimalText: Color
  var formGreyZoneText: Color
  var formFreshText: Color
  var formTransitionText: Color
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
      chartCasing: d.chartCasing.map { Color(hex: $0) } ?? f.chartCasing,
      formHighRisk: d.formHighRisk.map { Color(hex: $0) } ?? f.formHighRisk,
      formOptimal: d.formOptimal.map { Color(hex: $0) } ?? f.formOptimal,
      formGreyZone: d.formGreyZone.map { Color(hex: $0) } ?? f.formGreyZone,
      formFresh: d.formFresh.map { Color(hex: $0) } ?? f.formFresh,
      formTransition: d.formTransition.map { Color(hex: $0) } ?? f.formTransition,
      formHighRiskText: d.formHighRiskText.map { Color(hex: $0) } ?? f.formHighRiskText,
      formOptimalText: d.formOptimalText.map { Color(hex: $0) } ?? f.formOptimalText,
      formGreyZoneText: d.formGreyZoneText.map { Color(hex: $0) } ?? f.formGreyZoneText,
      formFreshText: d.formFreshText.map { Color(hex: $0) } ?? f.formFreshText,
      formTransitionText: d.formTransitionText.map { Color(hex: $0) } ?? f.formTransitionText,
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

  /// Text for a form zone: the form value, which the fills reach 2.1:1 to 2.7:1
  /// on the light widget ground and 4.5:1 is the bar for text.
  func formTextColor(_ zone: String?) -> Color {
    switch zone {
    case "highRisk": return formHighRiskText
    case "optimal": return formOptimalText
    case "greyZone": return formGreyZoneText
    case "fresh": return formFreshText
    case "transition": return formTransitionText
    default: return textPrimary
    }
  }

  /// Colour for a summary entry's palette role.
  func summaryColor(_ colorKey: String, formZone: String?) -> Color {
    switch colorKey {
    case "blue": return blue
    case "fatigue": return fatigue
    case "formZone": return formTextColor(formZone)
    default: return textPrimary
    }
  }

  static let lightFallback = WidgetPalette(
    background: WidgetTheme.Light.background, surface: WidgetTheme.Light.surface,
    textPrimary: WidgetTheme.Light.textPrimary, textSecondary: WidgetTheme.Light.textSecondary,
    primary: WidgetTheme.Light.primary, gold: WidgetTheme.Light.gold, blue: WidgetTheme.Light.blue,
    fatigue: WidgetTheme.Light.fatigue,
    chartFitness: WidgetTheme.Light.chartFitness, chartFatigue: WidgetTheme.Light.chartFatigue,
    chartCasing: WidgetTheme.Light.chartCasing,
    formHighRisk: WidgetTheme.Light.formHighRisk, formOptimal: WidgetTheme.Light.formOptimal,
    formGreyZone: WidgetTheme.Light.formGreyZone, formFresh: WidgetTheme.Light.formFresh,
    formTransition: WidgetTheme.Light.formTransition,
    formHighRiskText: WidgetTheme.Light.formHighRiskText,
    formOptimalText: WidgetTheme.Light.formOptimalText,
    formGreyZoneText: WidgetTheme.Light.formGreyZoneText,
    formFreshText: WidgetTheme.Light.formFreshText,
    formTransitionText: WidgetTheme.Light.formTransitionText,
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
    chartCasing: WidgetTheme.Dark.chartCasing,
    formHighRisk: WidgetTheme.Dark.formHighRisk, formOptimal: WidgetTheme.Dark.formOptimal,
    formGreyZone: WidgetTheme.Dark.formGreyZone, formFresh: WidgetTheme.Dark.formFresh,
    formTransition: WidgetTheme.Dark.formTransition,
    formHighRiskText: WidgetTheme.Dark.formHighRiskText,
    formOptimalText: WidgetTheme.Dark.formOptimalText,
    formGreyZoneText: WidgetTheme.Dark.formGreyZoneText,
    formFreshText: WidgetTheme.Dark.formFreshText,
    formTransitionText: WidgetTheme.Dark.formTransitionText,
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

/// The arrow by the direction the number went, and its variant by the judgement the app made:
/// filled for a change judged better, outlined for one judged worse, bare when flat or unjudged.
/// A Home Screen that draws the widget in one colour keeps the variant and loses the colour.
func trendSymbol(_ dir: String, _ verdict: String?) -> String {
  let arrow: String
  switch dir {
  case "up": arrow = "arrow.up"
  case "down": arrow = "arrow.down"
  default: arrow = "minus"
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
// a y domain buffered like the feed chart (so casing strokes at the extremes
// aren't clipped), and room for the form zone bar at the bottom.
private struct ChartPlot {
  let left: CGFloat
  let top: CGFloat
  let right: CGFloat
  let bottom: CGFloat
  let domainMin: Double
  let domainMax: Double
  let rawMin: Double
  let rawMax: Double

  static let axisFontSize: CGFloat = 8

  init(size: CGSize, rawMin: Double, rawMax: Double) {
    self.rawMin = rawMin
    self.rawMax = rawMax
    let minLabel = String(Int(rawMin.rounded()))
    let maxLabel = String(Int(rawMax.rounded()))
    let chars = CGFloat(max(minLabel.count, maxLabel.count))
    left = chars * (ChartPlot.axisFontSize * 0.62) + 4
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

// One cased line: dark under-stroke for edge contrast, colour stroke on top, dashed when the
// line must read apart from a solid one without its colour.
private struct CasedLine: View {
  let values: [Double]
  let plot: ChartPlot
  let color: Color
  let casing: Color
  let lineWidth: CGFloat
  var dash: [CGFloat] = []

  var body: some View {
    let xs = plot.xPositions(values.count)
    let ys = values.map { plot.yOf($0) }
    let path = monotonePath(xs: xs, ys: ys)
    path.stroke(
      casing, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: dash))
    path.stroke(
      color,
      style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round, dash: dash))
  }
}

// Axis rail: gridlines at the series min/max with their values in the left gutter.
private struct ChartAxis: View {
  let plot: ChartPlot
  let palette: WidgetPalette

  var body: some View {
    let marks = plot.rawMax > plot.rawMin ? [plot.rawMax, plot.rawMin] : [plot.rawMax]
    ForEach(marks.indices, id: \.self) { i in
      let value = marks[i]
      let y = plot.yOf(value)
      Path { p in
        p.move(to: CGPoint(x: plot.left, y: y))
        p.addLine(to: CGPoint(x: plot.right, y: y))
      }
      .stroke(palette.border, lineWidth: 0.5)
      Text(String(Int(value.rounded())))
        .measuredText("axis value")
        .font(.system(size: ChartPlot.axisFontSize))
        .foregroundColor(palette.textSecondary)
        .position(x: (plot.left - 4) / 2, y: min(max(y, 5), plot.bottom))
    }
  }
}

// Feed-style chart: monotone fitness + fatigue lines over a shared domain, and
// the axis rail. Fatigue is dashed, so the two lines read apart without their
// colours, and fitness is the accented one. Display-only (no link).
struct FitnessChartView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  var body: some View {
    GeometryReader { geo in
      let fitness = snapshot?.sparklines.fitness ?? []
      let fatigue = snapshot?.sparklines.fatigue ?? []
      let all = fitness + fatigue
      if fitness.count >= 2, let rawMin = all.min(), let rawMax = all.max() {
        let plot = ChartPlot(size: geo.size, rawMin: rawMin, rawMax: rawMax)
        ChartAxis(plot: plot, palette: palette)
        if fatigue.count >= 2 {
          CasedLine(
            values: fatigue, plot: plot, color: palette.chartFatigue,
            casing: palette.chartCasing, lineWidth: 1, dash: WidgetTheme.Chart.fatigueDash)
        }
        CasedLine(
          values: fitness, plot: plot, color: palette.chartFitness,
          casing: palette.chartCasing, lineWidth: 1.5)
        .widgetAccentable()
      }
    }
  }
}

// Single-series variant (HRV): one cased line with a faint fill, same axis rail.
struct SingleTrendChart: View {
  let values: [Double]
  let color: Color
  let palette: WidgetPalette

  var body: some View {
    GeometryReader { geo in
      if values.count >= 2, let rawMin = values.min(), let rawMax = values.max() {
        let plot = ChartPlot(size: geo.size, rawMin: rawMin, rawMax: rawMax)
        ChartAxis(plot: plot, palette: palette)
        FillPath(values: values, plot: plot, color: color)
        CasedLine(
          values: values, plot: plot, color: color, casing: palette.chartCasing, lineWidth: 1.5)
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
        .font(.system(size: WidgetTheme.TypeScale.metric, weight: .semibold))
        .foregroundColor(palette.primary)
      Text("Open Veloq")
        .measuredText("empty title")
        .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
        .foregroundColor(palette.textPrimary)
      Text("to see your training")
        .measuredText("empty subtitle")
        .font(.system(size: WidgetTheme.TypeScale.label))
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

  /// The moment a fresh snapshot turns stale, so the timeline can redraw the
  /// line then and not at the next scheduled reload.
  static func staleDate(_ snapshot: WidgetSnapshot?) -> Date? {
    reference(snapshot).map { Date(timeIntervalSince1970: $0 + staleAfter + 1) }
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
 * numbers give no clue how old they are. `.relative` is the system's own
 * phrasing and it ticks on its own, so the line stays honest between refreshes,
 * which a string formatted at save time would not. Past `SnapshotAge.staleAfter`
 * the line is amber and names the time.
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
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  private func when(_ seconds: Double) -> some View {
    let date = Date(timeIntervalSince1970: seconds)
    return Group {
      if SnapshotAge.isStale(since: seconds, now: snapshotNow ?? Date()) {
        Text(date, format: .dateTime.month(.abbreviated).day().hour().minute())
          .measuredText("age")
          .foregroundColor(palette.warning)
      } else {
        Text(date, style: .relative)
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

private struct AgeLineStyle: ViewModifier {
  let palette: WidgetPalette

  func body(content: Content) -> some View {
    content
      .font(.system(size: WidgetTheme.TypeScale.caption))
      .foregroundColor(palette.textSecondary)
      .lineLimit(1)
  }
}

// MARK: - Summary widget

extension WidgetPalette {
  /// The fill of a form zone's band on the large chart.
  func formFill(_ zone: String) -> Color {
    switch zone {
    case "highRisk": return formHighRisk
    case "optimal": return formOptimal
    case "greyZone": return formGreyZone
    case "fresh": return formFresh
    default: return formTransition
    }
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
            valueSize: WidgetTheme.TypeScale.hero)
          Spacer(minLength: 2)
          SummaryChartView(kind: content.chart, snapshot: snapshot, palette: palette)
            .frame(height: 40)
          SnapshotAgeLine(snapshot: snapshot, palette: palette)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetPadding(WidgetTheme.Layout.padding)
      case .medium, .large:
        VStack(alignment: .leading, spacing: 6) {
          HStack(alignment: .top, spacing: WidgetTheme.Layout.gap) {
            SummaryHero(
              content: content, palette: palette, formZone: formZone,
              valueSize: WidgetTheme.TypeScale.metric)
              .frame(maxWidth: .infinity, alignment: .leading)
            SummaryChartView(kind: content.chart, snapshot: snapshot, palette: palette)
              .frame(maxWidth: .infinity)
              .frame(height: 48)
          }
          Divider().background(palette.border)
          SummarySupportingRow(
            entries: content.supporting, palette: palette, formZone: formZone)
          if let zones = content.formZones {
            Divider().background(palette.border)
            FormZoneChartView(chart: zones, palette: palette)
              .frame(maxHeight: .infinity)
          } else {
            Spacer(minLength: 0)
          }
          SnapshotAgeLine(snapshot: snapshot, palette: palette)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetPadding(WidgetTheme.Layout.padding)
      }
    } else {
      EmptyWidgetView(palette: palette)
    }
  }
}

private struct SummaryHero: View {
  let content: SummaryContent
  let palette: WidgetPalette
  let formZone: String?
  let valueSize: CGFloat

  var body: some View {
    let hero = content.hero
    let color = palette.summaryColor(hero.colorKey, formZone: formZone)
    VStack(alignment: .leading, spacing: 2) {
      Text(hero.label.uppercased())
        .measuredText("hero label")
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
        .lineLimit(1)
      HStack(spacing: 4) {
        Text(hero.value)
          .measuredText("hero value")
          .font(.system(size: valueSize, weight: .bold))
          .foregroundColor(color)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .widgetAccentable()
        Image(systemName: trendSymbol(hero.trendDir, hero.verdict))
          .font(.system(size: WidgetTheme.TypeScale.label, weight: .bold))
          .foregroundColor(trendColor(hero.verdict, palette))
      }
      if let line = content.heroLine, !line.isEmpty {
        Text(line)
          .measuredText("hero line")
          .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
          .foregroundColor(color)
          .lineLimit(1)
      }
    }
  }
}

/// The chart beside the hero: nothing when the placement or the card hides it, or when the
/// snapshot holds no series for it.
private struct SummaryChartView: View {
  let kind: SummaryChartKind
  let snapshot: WidgetSnapshot
  let palette: WidgetPalette

  var body: some View {
    switch kind {
    case .none:
      EmptyView()
    case .fitnessForm:
      FitnessChartView(snapshot: snapshot, palette: palette)
    case .hrv:
      SingleTrendChart(values: snapshot.sparklines.hrv, color: palette.primary, palette: palette)
    }
  }
}

/// Up to four metrics side by side, split by dividers. The Form entry names its zone under its
/// value, which its colour alone would carry.
private struct SummarySupportingRow: View {
  let entries: [SummarySupporting]
  let palette: WidgetPalette
  let formZone: String?

  var body: some View {
    let captioned = entries.contains { $0.caption?.isEmpty == false }
    HStack(spacing: 0) {
      ForEach(Array(entries.enumerated()), id: \.offset) { index, supporting in
        let entry = supporting.entry
        let color = palette.summaryColor(entry.colorKey, formZone: formZone)
        if index > 0 {
          Divider().background(palette.border)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.label)
            .measuredText("metric label")
            .font(.system(size: WidgetTheme.TypeScale.caption))
            .foregroundColor(palette.textSecondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
          HStack(spacing: 3) {
            Text(entry.value)
              .measuredText("metric value")
              .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
              .foregroundColor(color)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
            Image(systemName: trendSymbol(entry.trendDir, entry.verdict))
              .font(.system(size: WidgetTheme.TypeScale.caption, weight: .bold))
              .foregroundColor(trendColor(entry.verdict, palette))
          }
          if let caption = supporting.caption, !caption.isEmpty {
            Text(caption)
              .measuredText("metric caption")
              .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
              .foregroundColor(color)
              .lineLimit(1)
              .minimumScaleFactor(0.7)
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

/// Form over six weeks against its five zone bands. A day with no value breaks the line.
///
/// A line marks each boundary between two bands in every mode. Drawn in one colour the bands
/// would all take one tint at one alpha, so there they alternate between two alphas instead.
private struct FormZoneChartView: View {
  @Environment(\.widgetRenderingMode) private var renderingMode
  let chart: FormZoneChart
  let palette: WidgetPalette

  private func bandOpacity(_ index: Int) -> Double {
    guard renderingMode == .accented else { return WidgetTheme.Chart.bandOpacity }
    let alphas = WidgetTheme.Chart.bandAccentedOpacities
    return alphas[index % alphas.count]
  }

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .topLeading) {
        ForEach(Array(chart.bands.enumerated()), id: \.element.zone) { index, band in
          Rectangle()
            .fill(palette.formFill(band.zone).opacity(bandOpacity(index)))
            .frame(
              width: geo.size.width,
              height: chart.y(band.from, height: geo.size.height)
                - chart.y(band.to, height: geo.size.height)
            )
            .offset(y: chart.y(band.to, height: geo.size.height))
        }
        boundaries(in: geo.size)
          .stroke(palette.textSecondary, lineWidth: WidgetTheme.Chart.bandBoundary)
        line(in: geo.size)
          .stroke(
            palette.textPrimary,
            style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
      }
    }
  }

  /// Every edge two bands share, which leaves out the chart's floor and ceiling.
  private func boundaries(in size: CGSize) -> Path {
    var path = Path()
    for band in chart.bands.dropFirst() {
      let y = chart.y(band.from, height: size.height)
      path.move(to: CGPoint(x: 0, y: y))
      path.addLine(to: CGPoint(x: size.width, y: y))
    }
    return path
  }

  private func line(in size: CGSize) -> Path {
    var path = Path()
    var open = false
    let last = max(chart.values.count - 1, 1)
    for (i, value) in chart.values.enumerated() {
      guard let value else {
        open = false
        continue
      }
      let point = CGPoint(
        x: size.width * CGFloat(i) / CGFloat(last), y: chart.y(value, height: size.height))
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
