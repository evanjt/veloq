import SwiftUI

// What a widget capture needs to judge whether a line of text is shown whole. SwiftUI lays a
// `Text` out without saying whether it truncated, so every text a widget draws carries
// `.measuredText(name)` as its first modifier. In the widget itself the measuring switch is off
// and the modifier adds nothing; a capture turns it on and reads every measure back from the
// `TextFitKey` preference.

/// One text as it was laid out, beside the room it would need to show whole.
struct TextFit: Equatable {
  /// The coordinate space a capture names on the widget's box.
  static let space = "widget-capture"

  let name: String
  /// Where the text was laid out, in the widget's box.
  let frame: CGRect
  /// Every line at full size, wrapped at the width it was given.
  let wrapped: CGSize
  /// All of it on one line at full size.
  let single: CGSize
  /// Every line at full size, wrapped at the width it was given divided by the smallest scale it
  /// may shrink to: the same lines it would wrap to at that scale, at full size.
  let shrunk: CGSize
  let lineLimit: Int?
  let minimumScaleFactor: CGFloat
}

struct TextFitKey: PreferenceKey {
  static let defaultValue: [TextFit] = []

  static func reduce(value: inout [TextFit], nextValue: () -> [TextFit]) {
    value.append(contentsOf: nextValue())
  }
}

private struct MeasuresTextKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// On only while a capture draws a widget.
  var measuresText: Bool {
    get { self[MeasuresTextKey.self] }
    set { self[MeasuresTextKey.self] = newValue }
  }
}

/// It reads the line limit and the scale factor from the environment, so it has to sit inside
/// the modifiers that set them: directly on the `Text`.
private struct MeasuredText: ViewModifier {
  @Environment(\.measuresText) private var measures
  @Environment(\.lineLimit) private var lineLimit
  @Environment(\.minimumScaleFactor) private var minimumScaleFactor
  let name: String

  @ViewBuilder
  func body(content: Content) -> some View {
    if measures {
      content.background(
        GeometryReader { box in
          content
            .lineLimit(nil)
            .minimumScaleFactor(1)
            .fixedSize(horizontal: false, vertical: true)
            .background(
              GeometryReader { wrapped in
                content
                  .lineLimit(1)
                  .minimumScaleFactor(1)
                  .fixedSize()
                  .background(
                    GeometryReader { single in
                      content
                        .lineLimit(nil)
                        .minimumScaleFactor(1)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(width: box.size.width / max(minimumScaleFactor, 0.01))
                        .background(
                          GeometryReader { shrunk in
                            Color.clear.preference(
                              key: TextFitKey.self,
                              value: [
                                TextFit(
                                  name: name, frame: box.frame(in: .named(TextFit.space)),
                                  wrapped: wrapped.size, single: single.size,
                                  shrunk: shrunk.size, lineLimit: lineLimit,
                                  minimumScaleFactor: minimumScaleFactor)
                              ])
                          })
                    })
              }
            )
            .frame(width: box.size.width, alignment: .topLeading)
            .hidden()
        })
    } else {
      content
    }
  }
}

extension View {
  /// Names a text for a widget capture, which reports it when it is cut off.
  func measuredText(_ name: String) -> some View {
    modifier(MeasuredText(name: name))
  }
}
