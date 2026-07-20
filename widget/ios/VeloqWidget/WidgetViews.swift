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
  var textMuted: Color
  var formHighRisk: Color
  var formOptimal: Color
  var formGreyZone: Color
  var formFresh: Color
  var formTransition: Color
  var trendUp: Color
  var trendDown: Color
  var trendFlat: Color
  var border: Color

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
      textMuted: d.textMuted.map { Color(hex: $0) } ?? f.textMuted,
      formHighRisk: d.formHighRisk.map { Color(hex: $0) } ?? f.formHighRisk,
      formOptimal: d.formOptimal.map { Color(hex: $0) } ?? f.formOptimal,
      formGreyZone: d.formGreyZone.map { Color(hex: $0) } ?? f.formGreyZone,
      formFresh: d.formFresh.map { Color(hex: $0) } ?? f.formFresh,
      formTransition: d.formTransition.map { Color(hex: $0) } ?? f.formTransition,
      trendUp: Color(hex: d.trendUp),
      trendDown: Color(hex: d.trendDown),
      trendFlat: Color(hex: d.trendFlat),
      border: Color(hex: d.border)
    )
  }

  static func resolve(_ snapshot: WidgetSnapshot?, _ scheme: ColorScheme) -> WidgetPalette {
    let fallback = scheme == .dark ? darkFallback : lightFallback
    if let theme = snapshot?.theme {
      return from(scheme == .dark ? theme.dark : theme.light, fallback: fallback)
    }
    return fallback
  }

  /// Colour for a form zone enum from the snapshot; unknown or missing zones read
  /// as plain primary text (older snapshots carry no zone).
  func formColor(_ zone: String?) -> Color {
    switch zone {
    case "highRisk": return formHighRisk
    case "optimal": return formOptimal
    case "greyZone": return formGreyZone
    case "fresh": return formFresh
    case "transition": return formTransition
    default: return textPrimary
    }
  }

  /// Colour for a summary entry's palette role.
  func summaryColor(_ colorKey: String, formZone: String?) -> Color {
    switch colorKey {
    case "blue": return blue
    case "fatigue": return fatigue
    case "formZone": return formColor(formZone)
    default: return textPrimary
    }
  }

  static let lightFallback = WidgetPalette(
    background: WidgetTheme.Light.background, surface: WidgetTheme.Light.surface,
    textPrimary: WidgetTheme.Light.textPrimary, textSecondary: WidgetTheme.Light.textSecondary,
    primary: WidgetTheme.Light.primary, gold: WidgetTheme.Light.gold, blue: WidgetTheme.Light.blue,
    fatigue: WidgetTheme.Light.fatigue,
    chartFitness: WidgetTheme.Light.chartFitness, chartFatigue: WidgetTheme.Light.chartFatigue,
    chartCasing: WidgetTheme.Light.chartCasing, textMuted: WidgetTheme.Light.textMuted,
    formHighRisk: WidgetTheme.Light.formHighRisk, formOptimal: WidgetTheme.Light.formOptimal,
    formGreyZone: WidgetTheme.Light.formGreyZone, formFresh: WidgetTheme.Light.formFresh,
    formTransition: WidgetTheme.Light.formTransition,
    trendUp: WidgetTheme.Light.trendUp, trendDown: WidgetTheme.Light.trendDown,
    trendFlat: WidgetTheme.Light.trendFlat, border: WidgetTheme.Light.border)

  static let darkFallback = WidgetPalette(
    background: WidgetTheme.Dark.background, surface: WidgetTheme.Dark.surface,
    textPrimary: WidgetTheme.Dark.textPrimary, textSecondary: WidgetTheme.Dark.textSecondary,
    primary: WidgetTheme.Dark.primary, gold: WidgetTheme.Dark.gold, blue: WidgetTheme.Dark.blue,
    fatigue: WidgetTheme.Dark.fatigue,
    chartFitness: WidgetTheme.Dark.chartFitness, chartFatigue: WidgetTheme.Dark.chartFatigue,
    chartCasing: WidgetTheme.Dark.chartCasing, textMuted: WidgetTheme.Dark.textMuted,
    formHighRisk: WidgetTheme.Dark.formHighRisk, formOptimal: WidgetTheme.Dark.formOptimal,
    formGreyZone: WidgetTheme.Dark.formGreyZone, formFresh: WidgetTheme.Dark.formFresh,
    formTransition: WidgetTheme.Dark.formTransition,
    trendUp: WidgetTheme.Dark.trendUp, trendDown: WidgetTheme.Dark.trendDown,
    trendFlat: WidgetTheme.Dark.trendFlat, border: WidgetTheme.Dark.border)
}

// MARK: - formatting helpers

func metricValue(_ v: Double) -> String { String(Int(v.rounded())) }

func signedInt(_ v: Double) -> String {
  let r = Int(v.rounded())
  return "\(r >= 0 ? "+" : "")\(r)"
}

func signedTenths(_ v: Double) -> String {
  let r = (v * 10).rounded() / 10
  return "\(r >= 0 ? "+" : "")\(r)"
}

func trendSymbol(_ dir: String) -> String {
  switch dir {
  case "up": return "arrow.up"
  case "down": return "arrow.down"
  default: return "minus"
  }
}

func trendColor(_ dir: String, _ p: WidgetPalette) -> Color {
  switch dir {
  case "up": return p.trendUp
  case "down": return p.trendDown
  default: return p.trendFlat
  }
}

// MARK: - hero metric resolution

// Everything a small/medium hero block needs for one metric key. Built from the
// snapshot so views stay dumb; unknown keys fall back to form.
struct HeroSpec {
  let label: String
  let metric: SnapshotMetric?
  let valueColor: Color
  let zoneLabel: String?
}

func heroSpec(_ snapshot: WidgetSnapshot?, key: String, palette: WidgetPalette) -> HeroSpec {
  let labels = snapshot?.display.metricLabels
  let m = snapshot?.metrics
  switch key {
  case "fitness":
    return HeroSpec(
      label: labels?.fitness ?? "Fitness", metric: m?.fitness, valueColor: palette.blue,
      zoneLabel: nil)
  case "fatigue":
    return HeroSpec(
      label: labels?.fatigue ?? "Fatigue", metric: m?.fatigue, valueColor: palette.fatigue,
      zoneLabel: nil)
  case "hrv":
    return HeroSpec(
      label: labels?.hrv ?? "HRV", metric: m?.hrv, valueColor: palette.textPrimary,
      zoneLabel: nil)
  case "rhr":
    return HeroSpec(
      label: labels?.rhr ?? "RHR", metric: m?.rhr, valueColor: palette.textPrimary,
      zoneLabel: nil)
  default:
    let zoneColor = palette.formColor(m?.form.zone)
    return HeroSpec(
      label: labels?.form ?? "Form", metric: m?.form,
      valueColor: m?.form.zone != nil ? zoneColor : palette.textPrimary,
      zoneLabel: snapshot?.display.formZone)
  }
}

// MARK: - reusable pieces

struct MetricColumn: View {
  let label: String
  let metric: SnapshotMetric
  let palette: WidgetPalette
  /// Series colour for the value (form zone, fitness blue, fatigue purple).
  var valueColor: Color?
  var showTrend: Bool = false

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label.uppercased())
        .font(.system(size: WidgetTheme.TypeScale.caption))
        .foregroundColor(palette.textSecondary)
      HStack(spacing: 4) {
        Text(metricValue(metric.value))
          .font(.system(size: WidgetTheme.TypeScale.metric, weight: .bold))
          .foregroundColor(valueColor ?? palette.textPrimary)
        if showTrend {
          Image(systemName: trendSymbol(metric.trendDir))
            .font(.system(size: WidgetTheme.TypeScale.caption, weight: .bold))
            .foregroundColor(trendColor(metric.trendDir, palette))
        }
      }
    }
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
  let barTop: CGFloat
  let rawMin: Double
  let rawMax: Double

  static let axisFontSize: CGFloat = 8
  static let formBarHeight: CGFloat = 4

  init(size: CGSize, rawMin: Double, rawMax: Double, hasFormBar: Bool) {
    self.rawMin = rawMin
    self.rawMax = rawMax
    let minLabel = String(Int(rawMin.rounded()))
    let maxLabel = String(Int(rawMax.rounded()))
    let chars = CGFloat(max(minLabel.count, maxLabel.count))
    left = chars * (ChartPlot.axisFontSize * 0.62) + 4
    top = 2
    right = size.width - 2
    bottom = hasFormBar ? size.height - ChartPlot.formBarHeight - 2 : size.height - 2
    barTop = size.height - ChartPlot.formBarHeight
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

// One cased line: dark under-stroke for edge contrast, colour stroke on top.
private struct CasedLine: View {
  let values: [Double]
  let plot: ChartPlot
  let color: Color
  let casing: Color
  let lineWidth: CGFloat

  var body: some View {
    let xs = plot.xPositions(values.count)
    let ys = values.map { plot.yOf($0) }
    let path = monotonePath(xs: xs, ys: ys)
    path.stroke(casing, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    path.stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
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
        .font(.system(size: ChartPlot.axisFontSize))
        .foregroundColor(palette.textMuted)
        .position(x: (plot.left - 4) / 2, y: min(max(y, 5), plot.bottom))
    }
  }
}

// Feed-style chart: monotone fitness + fatigue lines over a shared domain, a
// per-day form zone bar underneath, and the axis rail. Display-only (no link).
struct FitnessChartView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  var body: some View {
    GeometryReader { geo in
      let fitness = snapshot?.sparklines.fitness ?? []
      let fatigue = snapshot?.sparklines.fatigue ?? []
      let zones = snapshot?.sparklines.formZones ?? []
      let all = fitness + fatigue
      if fitness.count >= 2, let rawMin = all.min(), let rawMax = all.max() {
        let plot = ChartPlot(
          size: geo.size, rawMin: rawMin, rawMax: rawMax, hasFormBar: zones.count >= 2)
        ChartAxis(plot: plot, palette: palette)
        FormZoneBar(zones: zones, plot: plot, palette: palette)
        if fatigue.count >= 2 {
          CasedLine(
            values: fatigue, plot: plot, color: palette.chartFatigue,
            casing: palette.chartCasing, lineWidth: 1)
        }
        CasedLine(
          values: fitness, plot: plot, color: palette.chartFitness,
          casing: palette.chartCasing, lineWidth: 1.5)
      }
    }
  }
}

// Contiguous same-zone runs as coloured rects, edges at the midpoints between
// chart x positions (same geometry as the feed's form bar).
private struct FormZoneBar: View {
  let zones: [String]
  let plot: ChartPlot
  let palette: WidgetPalette

  var body: some View {
    let n = zones.count
    if n >= 2 {
      let step = (plot.right - plot.left) / CGFloat(n - 1)
      let runs = zoneRuns()
      ForEach(0..<runs.count, id: \.self) { r in
        let run = runs[r]
        let left = run.start == 0 ? plot.left : plot.left + (CGFloat(run.start) - 0.5) * step
        let right = run.end == n ? plot.right : plot.left + (CGFloat(run.end) - 0.5) * step
        Path { p in
          p.addRect(
            CGRect(
              x: left, y: plot.barTop, width: max(0, right - left - 0.5),
              height: ChartPlot.formBarHeight))
        }
        .fill(palette.formColor(run.zone))
      }
    }
  }

  private func zoneRuns() -> [(start: Int, end: Int, zone: String)] {
    var runs: [(Int, Int, String)] = []
    var start = 0
    for i in 1...zones.count {
      if i == zones.count || zones[i] != zones[start] {
        runs.append((start, i, zones[start]))
        start = i
      }
    }
    return runs
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
        let plot = ChartPlot(size: geo.size, rawMin: rawMin, rawMax: rawMax, hasFormBar: false)
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

// The chart a hero key shows: the TSB heroes and the summary "fitnessForm" mode all
// render the feed-style chart; HRV renders its own single series. Hidden otherwise.
struct HeroSparkline: View {
  let snapshot: WidgetSnapshot?
  let heroKey: String
  let palette: WidgetPalette

  private var kind: String {
    if heroKey == "summary" { return snapshot?.summaryCard?.sparkline ?? "fitnessForm" }
    switch heroKey {
    case "form", "fitness", "fatigue": return "fitnessForm"
    case "hrv": return "hrv"
    default: return "none"
    }
  }

  var body: some View {
    if kind == "fitnessForm" {
      FitnessChartView(snapshot: snapshot, palette: palette)
    } else if kind == "hrv", let hrv = snapshot?.sparklines.hrv, hrv.count >= 2 {
      SingleTrendChart(values: hrv, color: palette.primary, palette: palette)
    }
  }
}

// Structured before-after form impact, each value tinted by its own zone. Falls
// back to the flat pre-composed line when the structured fields are absent.
struct ImpactView: View {
  let impact: WidgetImpact?
  let fallbackLine: String?
  let palette: WidgetPalette

  var body: some View {
    if let i = impact {
      HStack(spacing: 3) {
        Text(metricValue(i.formBefore))
          .fontWeight(.semibold)
          .foregroundColor(palette.formColor(i.formBeforeZone))
        Image(systemName: "arrow.right")
          .font(.system(size: WidgetTheme.TypeScale.caption))
          .foregroundColor(palette.textSecondary)
        Text(metricValue(i.formAfter))
          .fontWeight(.semibold)
          .foregroundColor(palette.formColor(i.formAfterZone))
        if let tss = i.tssAdded {
          Text("\(signedInt(tss)) TSS")
            .foregroundColor(palette.textSecondary)
        }
      }
      .font(.system(size: WidgetTheme.TypeScale.label))
    } else if let line = fallbackLine, !line.isEmpty {
      Text(line)
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.primary)
        .lineLimit(2)
    }
  }
}

struct LatestBlock: View {
  let latest: WidgetLatest?
  let impact: WidgetImpact?
  let fallbackLine: String?
  let palette: WidgetPalette

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let l = latest {
        HStack(spacing: 4) {
          Text(l.name)
            .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
            .foregroundColor(Color(hex: l.tintHex))
            .lineLimit(1)
          if l.isPr == true {
            Circle().fill(palette.gold).frame(width: 6, height: 6)
          }
        }
        Text(subtitle(l))
          .font(.system(size: WidgetTheme.TypeScale.label))
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
      }
      ImpactView(impact: impact, fallbackLine: fallbackLine, palette: palette)
    }
  }

  private func subtitle(_ l: WidgetLatest) -> String {
    [l.distanceLabel, l.durationLabel, l.dateLabel].filter { !$0.isEmpty }.joined(separator: " · ")
  }
}

// One compact "Label 42 arrow" row used by summary entries and medium metric rows.
struct CompactMetricRow: View {
  let label: String
  let value: String
  let valueColor: Color
  let trendDir: String
  let palette: WidgetPalette

  var body: some View {
    HStack(spacing: 4) {
      Text(label)
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
        .lineLimit(1)
      Text(value)
        .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
        .foregroundColor(valueColor)
      Image(systemName: trendSymbol(trendDir))
        .font(.system(size: WidgetTheme.TypeScale.caption))
        .foregroundColor(trendColor(trendDir, palette))
    }
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
        .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
        .foregroundColor(palette.textPrimary)
      Text("to see your training")
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(WidgetTheme.Layout.padding)
  }
}

// MARK: - per-family layouts

// Small: one metric at a glance (configurable hero; default form). Zone-coloured
// hero for form, series colours otherwise, sparkline when the metric has one,
// gold award glyph when the latest activity set a PR.
struct SmallWidgetView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette
  var heroKey: String = "form"

  var body: some View {
    ZStack(alignment: .topTrailing) {
      if heroKey == "summary", let card = snapshot?.summaryCard {
        summaryContent(card)
      } else {
        metricContent
      }
      if snapshot?.latest?.isPr == true {
        // rosette: award glyph available since iOS 13 (trophy needs iOS 16).
        Image(systemName: "rosette")
          .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
          .foregroundColor(palette.gold)
      }
    }
    .padding(WidgetTheme.Layout.padding)
  }

  private var metricContent: some View {
    let spec = heroSpec(snapshot, key: heroKey, palette: palette)
    return VStack(alignment: .leading, spacing: 2) {
      Text(spec.label.uppercased())
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
      Text(spec.metric.map { metricValue($0.value) } ?? "-")
        .font(.system(size: WidgetTheme.TypeScale.hero, weight: .bold))
        .foregroundColor(spec.valueColor)
      HStack(spacing: 4) {
        if let zoneLabel = spec.zoneLabel, !zoneLabel.isEmpty {
          Text(zoneLabel)
            .fontWeight(.semibold)
            .foregroundColor(spec.valueColor)
            .lineLimit(1)
        }
        if let m = spec.metric {
          Image(systemName: trendSymbol(m.trendDir))
            .foregroundColor(trendColor(m.trendDir, palette))
          if let d = m.deltaVsYesterday {
            Text(signedInt(d)).foregroundColor(palette.textSecondary)
          }
        }
      }
      .font(.system(size: WidgetTheme.TypeScale.caption))
      Spacer(minLength: 2)
      HeroSparkline(snapshot: snapshot, heroKey: heroKey, palette: palette)
        .frame(height: 40)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func summaryContent(_ card: WidgetSummaryCard) -> some View {
    let formZone = snapshot?.metrics.form.zone
    return VStack(alignment: .leading, spacing: 2) {
      Text(card.hero.label.uppercased())
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
      HStack(spacing: 4) {
        Text(card.hero.value)
          .font(.system(size: WidgetTheme.TypeScale.hero, weight: .bold))
          .foregroundColor(palette.summaryColor(card.hero.colorKey, formZone: formZone))
        Image(systemName: trendSymbol(card.hero.trendDir))
          .font(.system(size: WidgetTheme.TypeScale.label, weight: .bold))
          .foregroundColor(trendColor(card.hero.trendDir, palette))
      }
      Spacer(minLength: 2)
      HeroSparkline(snapshot: snapshot, heroKey: "summary", palette: palette)
        .frame(height: 40)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// Medium: left hero (configurable) + compact fitness/fatigue rows; right sparkline
// + latest activity with structured impact. Summary mode swaps in the app-configured
// entries instead of the fixed rows.
struct MediumWidgetView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette
  var heroKey: String = "form"

  var body: some View {
    if snapshot == nil {
      EmptyWidgetView(palette: palette)
    } else if heroKey == "summary", let card = snapshot?.summaryCard {
      summaryContent(card)
    } else {
      metricContent
    }
  }

  private var metricContent: some View {
    let labels = snapshot?.display.metricLabels
    let spec = heroSpec(snapshot, key: heroKey, palette: palette)
    return HStack(alignment: .top, spacing: WidgetTheme.Layout.gap) {
      VStack(alignment: .leading, spacing: 6) {
        VStack(alignment: .leading, spacing: 2) {
          if let m = spec.metric {
            MetricColumn(
              label: spec.label, metric: m, palette: palette,
              valueColor: spec.valueColor, showTrend: true)
          }
          if let zoneLabel = spec.zoneLabel, !zoneLabel.isEmpty {
            Text(zoneLabel)
              .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
              .foregroundColor(spec.valueColor)
              .lineLimit(1)
          }
        }
        if heroKey != "fitness", let fit = snapshot?.metrics.fitness {
          CompactMetricRow(
            label: labels?.fitness ?? "Fitness", value: metricValue(fit.value),
            valueColor: palette.blue, trendDir: fit.trendDir, palette: palette)
        }
        if heroKey != "fatigue", let fat = snapshot?.metrics.fatigue {
          CompactMetricRow(
            label: labels?.fatigue ?? "Fatigue", value: metricValue(fat.value),
            valueColor: palette.fatigue, trendDir: fat.trendDir, palette: palette)
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      VStack(alignment: .leading, spacing: 6) {
        HeroSparkline(snapshot: snapshot, heroKey: heroKey, palette: palette)
          .frame(height: 48)
        LatestBlock(
          latest: snapshot?.latest,
          impact: snapshot?.impact,
          fallbackLine: snapshot?.display.impactLine,
          palette: palette)
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .padding(WidgetTheme.Layout.padding)
  }

  private func summaryContent(_ card: WidgetSummaryCard) -> some View {
    let formZone = snapshot?.metrics.form.zone
    return HStack(alignment: .top, spacing: WidgetTheme.Layout.gap) {
      VStack(alignment: .leading, spacing: 6) {
        VStack(alignment: .leading, spacing: 2) {
          Text(card.hero.label.uppercased())
            .font(.system(size: WidgetTheme.TypeScale.caption))
            .foregroundColor(palette.textSecondary)
          HStack(spacing: 4) {
            Text(card.hero.value)
              .font(.system(size: WidgetTheme.TypeScale.metric, weight: .bold))
              .foregroundColor(palette.summaryColor(card.hero.colorKey, formZone: formZone))
            Image(systemName: trendSymbol(card.hero.trendDir))
              .font(.system(size: WidgetTheme.TypeScale.caption, weight: .bold))
              .foregroundColor(trendColor(card.hero.trendDir, palette))
          }
        }
        ForEach(Array(card.entries.prefix(2).enumerated()), id: \.offset) { _, entry in
          CompactMetricRow(
            label: entry.label, value: entry.value,
            valueColor: palette.summaryColor(entry.colorKey, formZone: formZone),
            trendDir: entry.trendDir, palette: palette)
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      VStack(alignment: .leading, spacing: 6) {
        HeroSparkline(snapshot: snapshot, heroKey: "summary", palette: palette)
          .frame(height: 48)
        ForEach(Array(card.entries.dropFirst(2).enumerated()), id: \.offset) { _, entry in
          CompactMetricRow(
            label: entry.label, value: entry.value,
            valueColor: palette.summaryColor(entry.colorKey, formZone: formZone),
            trendDir: entry.trendDir, palette: palette)
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .padding(WidgetTheme.Layout.padding)
  }
}

// Large: full dashboard. Metric columns + ramp chip, dual sparkline, weekly row,
// latest with impact, HRV/RHR footer with a record deep-link glyph.
struct LargeWidgetView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  var body: some View {
    if snapshot == nil {
      EmptyWidgetView(palette: palette)
    } else {
      content
    }
  }

  private var content: some View {
    let m = snapshot?.metrics
    let labels = snapshot?.display.metricLabels
    let zoneColor = palette.formColor(m?.form.zone)
    return VStack(alignment: .leading, spacing: WidgetTheme.Layout.gap) {
      HStack(alignment: .top) {
        if let f = m?.form {
          MetricColumn(
            label: labels?.form ?? "Form", metric: f, palette: palette,
            valueColor: f.zone != nil ? zoneColor : nil, showTrend: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let f = m?.fitness {
          MetricColumn(
            label: labels?.fitness ?? "Fitness", metric: f, palette: palette,
            valueColor: palette.blue, showTrend: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let f = m?.fatigue {
          MetricColumn(
            label: labels?.fatigue ?? "Fatigue", metric: f, palette: palette,
            valueColor: palette.fatigue, showTrend: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let ramp = m?.rampRate {
          Text("\(labels?.ramp ?? "Ramp") \(signedTenths(ramp.value))/wk")
            .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
            .foregroundColor(palette.textSecondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
              Capsule().fill(palette.border.opacity(0.5)))
        }
      }
      FitnessChartView(snapshot: snapshot, palette: palette)
        .frame(height: 60)
      weeklyRow
      Divider().background(palette.border)
      LatestBlock(
        latest: snapshot?.latest,
        impact: snapshot?.impact,
        fallbackLine: snapshot?.display.impactLine,
        palette: palette)
      Spacer(minLength: 0)
      footer
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(WidgetTheme.Layout.padding)
  }

  private var weeklyRow: some View {
    HStack(spacing: 6) {
      Text(weeklyLine())
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
        .lineLimit(1)
      if let d = snapshot?.weekly.deltaPct {
        Text("\(signedInt(d))%")
          .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
          .foregroundColor(d >= 0 ? palette.trendUp : palette.trendDown)
          .padding(.horizontal, 5)
          .padding(.vertical, 2)
          .background(
            Capsule().fill((d >= 0 ? palette.trendUp : palette.trendDown).opacity(0.15)))
      }
    }
  }

  private func weeklyLine() -> String {
    guard let w = snapshot?.weekly else { return "" }
    let week = snapshot?.display.weekLabel ?? "Week"
    var parts = ["\(week) \(Int(w.count))"]
    if !w.durationLabel.isEmpty { parts.append(w.durationLabel) }
    if !w.distanceLabel.isEmpty { parts.append(w.distanceLabel) }
    parts.append("\(Int(w.tss.rounded())) TSS")
    return parts.joined(separator: " · ")
  }

  private var footer: some View {
    HStack(spacing: WidgetTheme.Layout.gap) {
      if let hrv = snapshot?.metrics.hrv {
        footerMetric(snapshot?.display.metricLabels.hrv ?? "HRV", hrv)
      }
      if let rhr = snapshot?.metrics.rhr {
        footerMetric(snapshot?.display.metricLabels.rhr ?? "RHR", rhr)
      }
      Spacer()
      if let url = URL(string: "veloq://record") {
        Link(destination: url) {
          Image(systemName: "record.circle")
            .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
            .foregroundColor(palette.primary)
        }
      }
    }
  }

  private func footerMetric(_ label: String, _ m: SnapshotMetric) -> some View {
    HStack(spacing: 3) {
      Text(label)
        .foregroundColor(palette.textSecondary)
      Text(metricValue(m.value))
        .fontWeight(.semibold)
        .foregroundColor(palette.textPrimary)
      Image(systemName: trendSymbol(m.trendDir))
        .font(.system(size: WidgetTheme.TypeScale.caption))
        .foregroundColor(trendColor(m.trendDir, palette))
    }
    .font(.system(size: WidgetTheme.TypeScale.label))
  }
}
