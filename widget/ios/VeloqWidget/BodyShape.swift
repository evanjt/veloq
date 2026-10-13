import SwiftUI

extension WidgetPalette {
  /// A muscle's fill: its shade on the ramp, or the untrained fill. Accented, as a tinted or
  /// clear Home Screen draws the widget, every part takes one colour and the shade is its alpha,
  /// which the system keeps where it may not keep a colour's lightness.
  func strengthFill(_ shade: Int?, accented: Bool) -> Color {
    guard accented else {
      return StrengthWidgetModel.rampIndex(shade, count: strengthRamp.count).map {
        strengthRamp[$0]
      } ?? bodyFill
    }
    let alphas = WidgetTheme.Body.accentedOpacities
    let alpha =
      StrengthWidgetModel.rampIndex(shade, count: alphas.count).map { alphas[$0] }
      ?? WidgetTheme.Body.accentedUntrainedOpacity
    return (strengthRamp.last ?? primary).opacity(alpha)
  }
}

/// One part of the body outline. Its rings fill as one path with the non-zero rule, as the drawing
/// library's SVG does, over the whole rect it is given.
struct BodyPartShape: Shape {
  let polygons: [[CGPoint]]

  func path(in rect: CGRect) -> Path {
    var path = Path()
    for ring in polygons where ring.count > 2 {
      path.addLines(
        ring.map { CGPoint(x: rect.minX + $0.x * rect.width, y: rect.minY + $0.y * rect.height) })
      path.closeSubpath()
    }
    return path
  }
}

/// One side of the body, every part in the untrained fill and each trained muscle in its shade,
/// scaled to fit the room it is given with the outline's own proportions kept. Accented, an
/// untrained part is also outlined, so the silhouette stays at its low alpha.
struct BodyView: View {
  let female: Bool
  let side: BodyOutline.Side
  let shades: [String: Int]
  let palette: WidgetPalette
  let accented: Bool

  /// The outline's box is twice as tall as it is wide.
  static let aspect: CGFloat = 0.5

  var body: some View {
    ZStack {
      ForEach(Array(BodyOutline.parts(female: female, side: side).enumerated()), id: \.offset) {
        _, part in
        let shade = shades[part.slug]
        let trained = StrengthWidgetModel.rampIndex(shade, count: palette.strengthRamp.count) != nil
        let shape = BodyPartShape(polygons: part.polygons)
        shape
          .fill(palette.strengthFill(shade, accented: accented))
          .overlay {
            if accented && !trained {
              shape.stroke(palette.textSecondary, lineWidth: WidgetTheme.Body.accentedOutline)
            }
          }
          .widgetAccentable(trained)
      }
    }
    .aspectRatio(Self.aspect, contentMode: .fit)
  }
}
