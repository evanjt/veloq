import SwiftUI
import WidgetKit

// Resolved palette the views render from. Dynamic colours come from the snapshot's
// theme block (picked by colour scheme); the generated WidgetTheme is the placeholder
// before any snapshot exists. No colour is hand-typed here.
struct WidgetPalette {
  var background: Color
  var surface: Color
  var textPrimary: Color
  var textSecondary: Color
  var primary: Color
  var gold: Color
  var blue: Color
  var trendUp: Color
  var trendDown: Color
  var trendFlat: Color
  var border: Color

  static func from(_ d: WidgetPaletteData) -> WidgetPalette {
    WidgetPalette(
      background: Color(hex: d.background),
      surface: Color(hex: d.surface),
      textPrimary: Color(hex: d.textPrimary),
      textSecondary: Color(hex: d.textSecondary),
      primary: Color(hex: d.primary),
      gold: Color(hex: d.gold),
      blue: Color(hex: d.blue),
      trendUp: Color(hex: d.trendUp),
      trendDown: Color(hex: d.trendDown),
      trendFlat: Color(hex: d.trendFlat),
      border: Color(hex: d.border)
    )
  }

  static func resolve(_ snapshot: WidgetSnapshot?, _ scheme: ColorScheme) -> WidgetPalette {
    if let theme = snapshot?.theme {
      return from(scheme == .dark ? theme.dark : theme.light)
    }
    return scheme == .dark ? darkFallback : lightFallback
  }

  static let lightFallback = WidgetPalette(
    background: WidgetTheme.Light.background, surface: WidgetTheme.Light.surface,
    textPrimary: WidgetTheme.Light.textPrimary, textSecondary: WidgetTheme.Light.textSecondary,
    primary: WidgetTheme.Light.primary, gold: WidgetTheme.Light.gold, blue: WidgetTheme.Light.blue,
    trendUp: WidgetTheme.Light.trendUp, trendDown: WidgetTheme.Light.trendDown,
    trendFlat: WidgetTheme.Light.trendFlat, border: WidgetTheme.Light.border)

  static let darkFallback = WidgetPalette(
    background: WidgetTheme.Dark.background, surface: WidgetTheme.Dark.surface,
    textPrimary: WidgetTheme.Dark.textPrimary, textSecondary: WidgetTheme.Dark.textSecondary,
    primary: WidgetTheme.Dark.primary, gold: WidgetTheme.Dark.gold, blue: WidgetTheme.Dark.blue,
    trendUp: WidgetTheme.Dark.trendUp, trendDown: WidgetTheme.Dark.trendDown,
    trendFlat: WidgetTheme.Dark.trendFlat, border: WidgetTheme.Dark.border)
}

// MARK: - formatting helpers

func metricValue(_ v: Double) -> String { String(Int(v.rounded())) }

func signedInt(_ v: Double) -> String {
  let r = Int(v.rounded())
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

// MARK: - reusable pieces

struct MetricColumn: View {
  let label: String
  let metric: WidgetMetric
  let palette: WidgetPalette
  var showTrend: Bool = false

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label.uppercased())
        .font(.system(size: WidgetTheme.TypeScale.caption))
        .foregroundColor(palette.textSecondary)
      HStack(spacing: 4) {
        Text(metricValue(metric.value))
          .font(.system(size: WidgetTheme.TypeScale.metric, weight: .bold))
          .foregroundColor(palette.textPrimary)
        if showTrend {
          Image(systemName: trendSymbol(metric.trendDir))
            .font(.system(size: WidgetTheme.TypeScale.caption, weight: .bold))
            .foregroundColor(trendColor(metric.trendDir, palette))
        }
      }
    }
  }
}

struct SparklineView: View {
  let values: [Double]
  let color: Color

  var body: some View {
    GeometryReader { geo in
      if values.count >= 2 {
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(maxV - minV, 0.0001)
        Path { path in
          for (i, v) in values.enumerated() {
            let x = geo.size.width * CGFloat(i) / CGFloat(values.count - 1)
            let y = geo.size.height * CGFloat(1 - (v - minV) / range)
            if i == 0 {
              path.move(to: CGPoint(x: x, y: y))
            } else {
              path.addLine(to: CGPoint(x: x, y: y))
            }
          }
        }
        .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
      }
    }
  }
}

struct LatestBlock: View {
  let latest: WidgetLatest?
  let impactLine: String?
  let palette: WidgetPalette

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let l = latest {
        Text(l.name)
          .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
          .foregroundColor(Color(hex: l.tintHex))
          .lineLimit(1)
        Text(subtitle(l))
          .font(.system(size: WidgetTheme.TypeScale.label))
          .foregroundColor(palette.textSecondary)
          .lineLimit(1)
      }
      if let impact = impactLine, !impact.isEmpty {
        Text(impact)
          .font(.system(size: WidgetTheme.TypeScale.label))
          .foregroundColor(palette.primary)
          .lineLimit(2)
      }
    }
  }

  private func subtitle(_ l: WidgetLatest) -> String {
    [l.distanceLabel, l.durationLabel, l.dateLabel].filter { !$0.isEmpty }.joined(separator: " · ")
  }
}

// MARK: - per-family layouts

struct SmallWidgetView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  var body: some View {
    let labels = snapshot?.display.metricLabels
    let form = snapshot?.metrics.form
    VStack(alignment: .leading, spacing: 4) {
      Text((labels?.form ?? "Form").uppercased())
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
      Text(form.map { metricValue($0.value) } ?? "—")
        .font(.system(size: WidgetTheme.TypeScale.hero, weight: .bold))
        .foregroundColor(palette.textPrimary)
      if let f = form {
        HStack(spacing: 4) {
          Image(systemName: trendSymbol(f.trendDir))
            .foregroundColor(trendColor(f.trendDir, palette))
          if let d = f.deltaVsYesterday {
            Text(signedInt(d)).foregroundColor(palette.textSecondary)
          }
        }
        .font(.system(size: WidgetTheme.TypeScale.label))
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(WidgetTheme.Layout.padding)
  }
}

struct MediumWidgetView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  var body: some View {
    let labels = snapshot?.display.metricLabels
    HStack(alignment: .top, spacing: WidgetTheme.Layout.gap) {
      VStack(alignment: .leading, spacing: 6) {
        if let form = snapshot?.metrics.form {
          MetricColumn(label: labels?.form ?? "Form", metric: form, palette: palette, showTrend: true)
        }
        if let fit = snapshot?.metrics.fitness {
          HStack(spacing: 4) {
            Text(labels?.fitness ?? "Fitness")
              .font(.system(size: WidgetTheme.TypeScale.label))
              .foregroundColor(palette.textSecondary)
            Text(metricValue(fit.value))
              .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
              .foregroundColor(palette.textPrimary)
            Image(systemName: trendSymbol(fit.trendDir))
              .font(.system(size: WidgetTheme.TypeScale.caption))
              .foregroundColor(trendColor(fit.trendDir, palette))
          }
        }
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      LatestBlock(
        latest: snapshot?.latest,
        impactLine: snapshot?.display.impactLine,
        palette: palette
      )
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .padding(WidgetTheme.Layout.padding)
  }
}

struct LargeWidgetView: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette

  var body: some View {
    let m = snapshot?.metrics
    let labels = snapshot?.display.metricLabels
    VStack(alignment: .leading, spacing: WidgetTheme.Layout.gap) {
      HStack(alignment: .top) {
        if let f = m?.fitness {
          MetricColumn(label: labels?.fitness ?? "Fitness", metric: f, palette: palette)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let f = m?.fatigue {
          MetricColumn(label: labels?.fatigue ?? "Fatigue", metric: f, palette: palette)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let f = m?.form {
          MetricColumn(label: labels?.form ?? "Form", metric: f, palette: palette, showTrend: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      if let spark = snapshot?.sparklines.fitness, spark.count >= 2 {
        SparklineView(values: spark, color: palette.blue).frame(height: 34)
      }
      Text(weeklyLine())
        .font(.system(size: WidgetTheme.TypeScale.label))
        .foregroundColor(palette.textSecondary)
      Divider().background(palette.border)
      LatestBlock(
        latest: snapshot?.latest,
        impactLine: snapshot?.display.impactLine,
        palette: palette
      )
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(WidgetTheme.Layout.padding)
  }

  private func weeklyLine() -> String {
    guard let w = snapshot?.weekly else { return "" }
    let week = snapshot?.display.weekLabel ?? "Week"
    var parts = ["\(week)  \(Int(w.tss.rounded())) TSS"]
    if !w.distanceLabel.isEmpty { parts.append(w.distanceLabel) }
    if let d = w.deltaPct { parts.append("\(signedInt(d))%") }
    return parts.joined(separator: " · ")
  }
}
