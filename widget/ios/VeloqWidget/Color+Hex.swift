import SwiftUI

// Builds a Color from a "#RRGGBB"/"#RRGGBBAA" string. Holds no colour literal itself —
// the hex strings come from the snapshot's theme block or the generated WidgetTheme,
// both rooted in src/theme/colors.ts. This keeps widget colour out of hand-typed hex.
extension Color {
  init(hex: String) {
    let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
    var rgb: UInt64 = 0
    Scanner(string: cleaned).scanHexInt64(&rgb)

    let r: Double
    let g: Double
    let b: Double
    let a: Double
    if cleaned.count == 8 {
      r = Double((rgb >> 24) & 0xFF) / 255
      g = Double((rgb >> 16) & 0xFF) / 255
      b = Double((rgb >> 8) & 0xFF) / 255
      a = Double(rgb & 0xFF) / 255
    } else {
      r = Double((rgb >> 16) & 0xFF) / 255
      g = Double((rgb >> 8) & 0xFF) / 255
      b = Double(rgb & 0xFF) / 255
      a = 1
    }
    self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
  }
}
