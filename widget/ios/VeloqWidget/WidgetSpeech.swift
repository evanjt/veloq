import SwiftUI

// What a screen reader says for the marks a widget draws. A drawn line, an arrow coloured by its
// verdict and a dot coloured by its tone say nothing aloud, so each carries the words the engine
// composed for it. In the widget the measuring switch is off and the modifiers only set the
// accessibility label. A capture turns it on and reads every mark back from `SpokenMarkKey`, so a
// mark the widget draws without words fails there.

/// One mark as a screen reader reaches it.
struct SpokenMark: Equatable {
  let name: String
  /// Empty when the mark reached the screen reader with no words.
  let label: String
}

struct SpokenMarkKey: PreferenceKey {
  static let defaultValue: [SpokenMark] = []

  static func reduce(value: inout [SpokenMark], nextValue: () -> [SpokenMark]) {
    value.append(contentsOf: nextValue())
  }
}

/// What a mark with no words of its own does: a group of texts still reads its texts, and a
/// drawing, which has nothing to read, is left out.
enum SpokenFallback {
  case combine
  case hide
}

private struct Spoken: ViewModifier {
  @Environment(\.measuresText) private var measures
  let name: String
  let label: String?
  let fallback: SpokenFallback

  private var words: String? { label.flatMap { $0.isEmpty ? nil : $0 } }

  @ViewBuilder
  private func marked(_ content: Content) -> some View {
    if let words {
      content
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(words)
    } else if fallback == .combine {
      content.accessibilityElement(children: .combine)
    } else {
      content.accessibilityHidden(true)
    }
  }

  @ViewBuilder
  func body(content: Content) -> some View {
    if measures {
      marked(content).background(
        Color.clear.preference(
          key: SpokenMarkKey.self, value: [SpokenMark(name: name, label: words ?? "")]))
    } else {
      marked(content)
    }
  }
}

extension View {
  /// One element a screen reader reads as `label`: a metric with its verdict, a chart, a route,
  /// a body, a tone. With no label a group reads its texts and a drawing is left out.
  func spoken(_ name: String, _ label: String?, otherwise fallback: SpokenFallback = .hide)
    -> some View
  {
    modifier(Spoken(name: name, label: label, fallback: fallback))
  }

  /// A mark that repeats what a text beside it already says, so a screen reader skips it.
  func unspoken() -> some View {
    accessibilityHidden(true)
  }
}
