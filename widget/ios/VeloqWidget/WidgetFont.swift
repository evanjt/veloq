import SwiftUI

/// A step of the type scale at the reader's text size. The step grows with its text style the
/// way the system's own text does. A figure, a label or a caption stops at `maxTextScale` times
/// its default size, so a data-dense surface keeps its layout; a line of prose follows the
/// setting as far as it goes, accessibility sizes included.
private struct WidgetFont: ViewModifier {
  @ScaledMetric private var scaled: CGFloat
  @Environment(\.legibilityWeight) private var legibility
  private let step: WidgetTheme.TypeStep
  private let weight: Font.Weight
  private let shrinks: Bool
  private let prose: Bool

  init(_ step: WidgetTheme.TypeStep, weight: Font.Weight, shrinks: Bool, prose: Bool) {
    _scaled = ScaledMetric(wrappedValue: step.size, relativeTo: step.style)
    self.step = step
    self.weight = weight
    self.shrinks = shrinks
    self.prose = prose
  }

  func body(content: Content) -> some View {
    let size = prose ? scaled : step.capped(scaled)
    let font = Font.widget(size, weight: weight, boldText: legibility == .bold)
    if shrinks {
      content
        .font(font)
        .minimumScaleFactor(min(1, WidgetTheme.TypeScale.floor / size))
    } else {
      content.font(font)
    }
  }
}

/// A fixed size of the widget face, for text sized to a chart rather than to the type scale.
private struct WidgetFixedFont: ViewModifier {
  @Environment(\.legibilityWeight) private var legibility
  let size: CGFloat
  let weight: Font.Weight

  func body(content: Content) -> some View {
    content.font(.widget(size, weight: weight, boldText: legibility == .bold))
  }
}

extension WidgetTheme.Face {
  /// The bundled file a weight draws: medium and semibold draw the semibold file, bold and
  /// heavier the bold one, anything lighter the regular one. With the reader's Bold Text on it
  /// draws one file heavier, as the system face does, and bold stays bold.
  static func name(_ weight: Font.Weight, boldText: Bool = false) -> String {
    let files = [regular, semibold, bold]
    let step: Int
    switch weight {
    case .bold, .heavy, .black: step = 2
    case .medium, .semibold: step = 1
    default: step = 0
    }
    return files[min(files.count - 1, step + (boldText ? 1 : 0))]
  }
}

extension Font {
  /// The widget face at a size already scaled to the reader's text size, so it is fixed here
  /// rather than scaled a second time.
  static func widget(_ size: CGFloat, weight: Font.Weight = .regular, boldText: Bool = false)
    -> Font
  {
    .custom(WidgetTheme.Face.name(weight, boldText: boldText), fixedSize: size)
  }
}

extension WidgetTheme.TypeStep {
  /// The step at a size the reader's text size scaled it to, held to `maxTextScale` times its
  /// default size.
  func capped(_ scaled: CGFloat) -> CGFloat {
    min(scaled, size * WidgetTheme.maxTextScale)
  }
}

extension View {
  /// Sets the font of a figure, a label or a caption to one step of the widget type scale, at the
  /// reader's text size up to `maxTextScale` times the step. A line that `shrinks` is fitted to
  /// its box down to the floor rather than cut off.
  func widgetFont(
    _ step: WidgetTheme.TypeStep, weight: Font.Weight = .regular, shrinks: Bool = false
  ) -> some View {
    modifier(WidgetFont(step, weight: weight, shrinks: shrinks, prose: false))
  }

  /// Sets the font of a line of prose, a name, a finding or a prompt, to one step of the widget
  /// type scale at the reader's text size, however large. A line that `shrinks` is fitted to its
  /// box down to the floor rather than cut off.
  func widgetProseFont(
    _ step: WidgetTheme.TypeStep, weight: Font.Weight = .regular, shrinks: Bool = false
  ) -> some View {
    modifier(WidgetFont(step, weight: weight, shrinks: shrinks, prose: true))
  }

  /// Sets the font to the widget face at a fixed size, for a label sized to a chart. It does
  /// not follow the reader's text size, since the chart it labels does not.
  func widgetFont(size: CGFloat, weight: Font.Weight = .regular) -> some View {
    modifier(WidgetFixedFont(size: size, weight: weight))
  }
}
