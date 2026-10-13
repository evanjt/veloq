import SwiftUI

/// A step of the type scale at the reader's text size. The step grows with its text style the
/// way the system's own text does. A figure, a label or a caption stops at `maxTextScale` times
/// its default size, so a data-dense surface keeps its layout; a line of prose follows the
/// setting as far as it goes, accessibility sizes included.
private struct WidgetFont: ViewModifier {
  @ScaledMetric private var scaled: CGFloat
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
    if shrinks {
      content
        .font(.system(size: size, weight: weight))
        .minimumScaleFactor(min(1, WidgetTheme.TypeScale.floor / size))
    } else {
      content.font(.system(size: size, weight: weight))
    }
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
}
