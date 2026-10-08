import SwiftUI

extension WidgetPalette {
  /// A muscle's fill: its shade on the ramp, or the untrained fill.
  func strengthFill(_ shade: Int?) -> Color {
    StrengthWidgetModel.rampIndex(shade, count: strengthRamp.count).map { strengthRamp[$0] }
      ?? bodyFill
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
/// scaled to fit the room it is given with the outline's own proportions kept.
struct BodyView: View {
  let female: Bool
  let side: BodyOutline.Side
  let shades: [String: Int]
  let palette: WidgetPalette

  /// The outline's box is twice as tall as it is wide.
  static let aspect: CGFloat = 0.5

  var body: some View {
    ZStack {
      ForEach(Array(BodyOutline.parts(female: female, side: side).enumerated()), id: \.offset) {
        _, part in
        BodyPartShape(polygons: part.polygons).fill(palette.strengthFill(shades[part.slug]))
      }
    }
    .aspectRatio(Self.aspect, contentMode: .fit)
  }
}
