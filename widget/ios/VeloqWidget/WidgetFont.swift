import SwiftUI

/// A step of the type scale at the reader's text size. The step grows with its text style the
/// way the system's own text does, up to `maxTextScale` times its default size, and
/// `widgetTextSize()` on the root keeps the accessibility sizes out.
private struct WidgetFont: ViewModifier {
  @ScaledMetric private var scaled: CGFloat
  private let step: WidgetTheme.TypeStep
  private let weight: Font.Weight
  private let shrinks: Bool

  init(_ step: WidgetTheme.TypeStep, weight: Font.Weight, shrinks: Bool) {
    _scaled = ScaledMetric(wrappedValue: step.size, relativeTo: step.style)
    self.step = step
    self.weight = weight
    self.shrinks = shrinks
  }

  func body(content: Content) -> some View {
    let size = step.capped(scaled)
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
  /// Sets the font to one step of the widget type scale, at the reader's text size. A line that
  /// `shrinks` is fitted to its box down to the floor rather than cut off.
  func widgetFont(
    _ step: WidgetTheme.TypeStep, weight: Font.Weight = .regular, shrinks: Bool = false
  ) -> some View {
    modifier(WidgetFont(step, weight: weight, shrinks: shrinks))
  }

  /// Follows the reader's text size up to the largest the widgets and the Live Activity take,
  /// so a data-dense surface keeps its layout at the accessibility sizes.
  func widgetTextSize() -> some View {
    dynamicTypeSize(...WidgetTheme.largestTextSize)
  }
}
