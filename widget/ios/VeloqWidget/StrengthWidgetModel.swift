import Foundation

// What the Strength widget draws, decided from the snapshot alone. It imports no UI framework, so
// the choices are plain values: which window a placement shows, which sides of the body a size
// draws, the shade each muscle takes and the rows the largest size lists.
//
// The engine shades and words both windows; the widget picks one and draws it. A window with no
// strength sessions carries the words to show in place of the body, so a blank body never reads
// as a month of no load.

/// The strength block: the body the strength tab draws and its two windows.
struct WidgetStrength: Codable {
  /// `male` or `female`.
  let body: String
  /// The strength tab on the trailing 30 days.
  let url: String
  let windows: WidgetStrengthWindows
}

struct WidgetStrengthWindows: Codable {
  let last30: WidgetStrengthWindow
  let month: WidgetStrengthWindow
}

struct WidgetStrengthWindow: Codable {
  /// What a header calls the window: the strength tab's name for 30 days, or the month's name.
  let label: String
  /// Every trained muscle and its shade, most trained first.
  let muscles: [WidgetStrengthMuscle]
  /// The most trained muscles, named and worded.
  let top: [WidgetStrengthTopMuscle]
  /// The words in place of the body when the window holds no strength sessions.
  let emptyText: String?
  /// What the shaded body shows, as a screen reader says it: the most trained muscles and their
  /// sets. Nil where no body is drawn, and on a snapshot written before schema 16.
  let bodyLabel: String?
}

struct WidgetStrengthMuscle: Codable {
  let slug: String
  /// 1, the lightest, up to the length of the palette's ramp.
  let shade: Int
}

struct WidgetStrengthTopMuscle: Codable {
  let slug: String
  let name: String
  let setsText: String
  /// Absent for bodyweight work.
  let volumeText: String?
}

/// The window a placement shows. Unconfigured is the last 30 days, where the strength tab opens.
enum StrengthWindowChoice: String {
  case last30
  case month
}

enum StrengthSize {
  case small
  case medium
  case large
}

/// One placement's drawing.
struct StrengthContent {
  let label: String
  let female: Bool
  /// The sides of the body, left to right; empty when the window draws its words instead.
  let sides: [BodyOutline.Side]
  /// Each trained muscle's shade by slug; a part not listed takes the untrained fill.
  let shades: [String: Int]
  let top: [WidgetStrengthTopMuscle]
  let emptyText: String?
  /// What a screen reader says for the bodies.
  let bodyLabel: String?
  let url: URL?
}

enum StrengthWidgetModel {
  static func window(_ strength: WidgetStrength, _ choice: StrengthWindowChoice)
    -> WidgetStrengthWindow
  {
    switch choice {
    case .last30: return strength.windows.last30
    case .month: return strength.windows.month
    }
  }

  static func sides(_ size: StrengthSize) -> [BodyOutline.Side] {
    size == .small ? [.front] : [.front, .back]
  }

  /// Nil for a snapshot written before the strength block, which draws as no snapshot does.
  static func content(
    _ snapshot: WidgetSnapshot?, size: StrengthSize, choice: StrengthWindowChoice
  ) -> StrengthContent? {
    guard let strength = snapshot?.strength else { return nil }
    let shown = window(strength, choice)
    let empty = shown.emptyText.flatMap { $0.isEmpty ? nil : $0 }
    var shades: [String: Int] = [:]
    for muscle in shown.muscles where shades[muscle.slug] == nil {
      shades[muscle.slug] = muscle.shade
    }
    return StrengthContent(
      label: shown.label,
      female: strength.body == "female",
      sides: empty == nil ? sides(size) : [],
      shades: shades,
      top: empty == nil && size == .large ? shown.top : [],
      emptyText: empty,
      bodyLabel: empty == nil ? shown.bodyLabel : nil,
      url: URL(string: strength.url))
  }

  /// The ramp entry a shade takes, or nil for the untrained fill. A shade past the ramp's end
  /// takes its darkest entry, so a longer engine scale still reads as the most trained.
  static func rampIndex(_ shade: Int?, count: Int) -> Int? {
    guard let shade = shade, shade >= 1, count > 0 else { return nil }
    return min(shade, count) - 1
  }
}
