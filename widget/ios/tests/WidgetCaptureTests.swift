import SwiftUI
import WidgetKit
import XCTest

@testable import VeloqWidget

/// Scenario: every widget is drawn at every family it supports, in the smallest and the largest
/// box an iPhone and an iPad give that family, in light, in dark and in the accented mode of the
/// tinted and clear Home Screens, and in colour at the largest text size the widgets follow, with
/// the sample library, with the longest words the locales have, with an empty library and with
/// rides and no wellness reading.
///
/// Expected behaviour: no text is truncated, squeezed to fewer lines than it needs or pushed out
/// of the widget, an empty library draws the open-the-app prompt, a Summary row that lists form
/// names its zone, and a Summary chart names its series, its span and its zones. Every placement
/// is saved as a PNG under `WIDGET_CAPTURES_DIR`, so a failure can be looked at rather than only
/// read. An accented placement is saved as the system draws its one colour: every pixel the
/// widget paints in white at the alpha it was painted with, on no ground of its own, so what is
/// left is what the widget says without hue.
///
/// Runs on the iOS simulator: `ImageRenderer` lays the views out with the platform's own text.
@MainActor
final class WidgetCaptureTests: XCTestCase {
  private struct Widget {
    let name: String
    let families: [WidgetFamily]
    let draw: (WidgetSnapshot, WidgetFamily, Date) -> AnyView
  }

  private let widgets: [Widget] = [
    Widget(name: "summary", families: [.systemSmall, .systemMedium, .systemLarge]) {
      AnyView(VeloqWidgetEntryView(entry: VeloqEntry(date: $2, snapshot: $0), family: $1))
    },
    Widget(name: "summary-fitness", families: [.systemSmall, .systemMedium, .systemLarge]) {
      AnyView(
        VeloqWidgetEntryView(
          entry: VeloqEntry(date: $2, snapshot: $0, placement: SummaryPlacement(hero: "fitness")),
          family: $1))
    },
    Widget(name: "activity", families: [.systemSmall, .systemMedium]) {
      AnyView(LatestActivityView(entry: VeloqEntry(date: $2, snapshot: $0), family: $1))
    },
    Widget(name: "insights", families: [.systemSmall, .systemMedium, .systemLarge]) {
      AnyView(InsightsWidgetView(entry: InsightsEntry(date: $2, snapshot: $0), family: $1))
    },
    Widget(name: "strength", families: [.systemSmall, .systemMedium, .systemLarge]) {
      AnyView(StrengthWidgetView(entry: StrengthEntry(date: $2, snapshot: $0), family: $1))
    },
    Widget(name: "strength-month", families: [.systemSmall, .systemMedium, .systemLarge]) {
      AnyView(
        StrengthWidgetView(
          entry: StrengthEntry(date: $2, snapshot: $0, window: .month), family: $1))
    },
    Widget(name: "strength-empty", families: [.systemSmall, .systemMedium, .systemLarge]) {
      AnyView(
        StrengthWidgetView(
          entry: StrengthEntry(date: $2, snapshot: WidgetCaptureTests.emptyStrengthMonth($0), window: .month),
          family: $1))
    },
    Widget(name: "record", families: [.systemSmall]) { snapshot, _, _ in
      AnyView(RecordWidgetView(url: RecordDeepLink.url(for: snapshot)))
    },
  ]

  /// The box each family gets on the smallest and the largest iPhone screen the app installs on,
  /// 375 by 667 and 430 by 932 points, then on the smallest and the largest iPad screen, 744 by
  /// 1133 and 1192 by 1590 points with Display Zoom at More Space, from the platform's table of
  /// widget sizes. An iPad lays a widget out in its canvas box and scales it down to the device,
  /// so the canvas is the box. The iPhone boxes come first: the tests that take one box per
  /// family read the smallest and the largest iPhone.
  private struct Box {
    let screen: String
    let size: CGSize
  }

  private func boxes(_ family: WidgetFamily) -> [Box] {
    switch family {
    case .systemSmall:
      return [
        Box(screen: "375", size: CGSize(width: 148, height: 148)),
        Box(screen: "430", size: CGSize(width: 170, height: 170)),
        Box(screen: "ipad-744", size: CGSize(width: 141, height: 141)),
        Box(screen: "ipad-1192", size: CGSize(width: 188, height: 188)),
      ]
    case .systemMedium:
      return [
        Box(screen: "375", size: CGSize(width: 321, height: 148)),
        Box(screen: "430", size: CGSize(width: 364, height: 170)),
        Box(screen: "ipad-744", size: CGSize(width: 305.5, height: 141)),
        Box(screen: "ipad-1192", size: CGSize(width: 412, height: 188)),
      ]
    default:
      return [
        Box(screen: "375", size: CGSize(width: 321, height: 324)),
        Box(screen: "430", size: CGSize(width: 364, height: 382)),
        Box(screen: "ipad-744", size: CGSize(width: 305.5, height: 305.5)),
        Box(screen: "ipad-1192", size: CGSize(width: 412, height: 412)),
      ]
    }
  }

  /// The margin the Home Screen keeps inside a widget since iOS 17, which none of these widgets
  /// turns off. Before iOS 17 there is none, so this is the tighter of the two.
  private let contentMargin: CGFloat = 16

  /// The three ways a Home Screen draws a widget: in colour on a light or a dark ground, or in
  /// one colour with no ground at all.
  private enum Mode: String, CaseIterable {
    case light
    case dark
    case accented
  }

  /// The texts a placement has to draw, besides drawing every text whole.
  private func expected(
    _ widget: String, _ family: WidgetFamily, _ screen: String, _ fixture: String
  ) -> [String] {
    if fixture == "empty" { return widget == "record" ? [] : ["empty title"] }
    if widget.hasPrefix("summary"), family != .systemSmall {
      var texts: [String] = []
      // A fitness hero moves form onto the row, which then names its zone.
      if widget == "summary-fitness" { texts.append("metric caption") }
      // The fitness chart names its two lines and the days they span; the large form chart
      // names its zone and labels the bounds between zones.
      if fixture == "demo" || fixture == "long-text" {
        texts += ["chart series", "chart span"]
        if family == .systemLarge { texts += ["form chart zone", "zone bound"] }
      }
      return texts
    }
    // The sample library's form line has room under the comparison on the larger medium box.
    if widget == "activity", family == .systemMedium, screen == "430", fixture == "demo" {
      return ["form zone"]
    }
    return []
  }

  func testEveryWidgetDrawsEveryTextWholeAtEveryFamily() throws {
    let out = try capturesDirectory()
    var failures: [String] = []
    for fixture in ["demo", "long-text", "empty", "no-wellness"] {
      let snapshot = try self.snapshot(fixture)
      for widget in widgets {
        for family in widget.families {
          for box in boxes(family) {
            let expected = expected(widget.name, family, box.screen, fixture)
            for mode in Mode.allCases {
              let name = [widget.name, familyName(family), box.screen, fixture, mode.rawValue]
                .joined(separator: "-")
              let view = widget.draw(snapshot, family, Date())
              failures += capture(name, view, snapshot, box.size, mode, out, expected)
            }
            // The largest text size there is, in colour: the modes draw one layout.
            let name = [widget.name, familyName(family), box.screen, fixture, "largest-text"]
              .joined(separator: "-")
            let view = widget.draw(snapshot, family, Date())
            // The form line is among the first to give way at a larger text size.
            failures += capture(
              name, view, snapshot, box.size, .light, out, expected.filter { $0 != "form zone" },
              textSize: .accessibility5)
          }
        }
      }
    }
    XCTAssert(
      failures.isEmpty,
      "Cut-off or missing text in \(failures.count) places, captures in \(out.path):\n"
        + failures.joined(separator: "\n"))
  }

  /// The lines that read as sentences rather than as figures: a name, a finding, a prompt. They
  /// follow the reader's text size as far as it goes, where a figure stops at its cap.
  private let proseTexts: Set<String> = [
    "insight title", "insight subtitle", "no insights", "empty title", "empty subtitle",
    "empty window", "activity name", "detail", "section records",
  ]

  /// Scenario: the reader picks the smallest text size in Settings, then the default, then the
  /// largest standard size, then one of the accessibility sizes past it.
  ///
  /// Expected behaviour: every text a widget draws is taller at the largest standard size than at
  /// the smallest. A figure, a label or a caption is never more than `maxTextScale` times its
  /// height at the default size, at an accessibility size too, while a line of prose keeps
  /// growing past the largest standard size.
  func testEveryWidgetFollowsTheReadersTextSizeWithFiguresCapped() throws {
    let snapshot = try self.snapshot("demo")
    var failures: [String] = []
    for widget in widgets {
      for family in widget.families {
        let name = "\(widget.name)-\(familyName(family))"
        let size = boxes(family)[1].size
        func heights(_ textSize: DynamicTypeSize) -> [String: CGFloat] {
          let view = widget.draw(snapshot, family, Date())
            .padding(contentMargin)
            .frame(width: size.width, height: size.height)
            .environment(\.dynamicTypeSize, textSize)
          let fits = measure(view, size)
          return Dictionary(
            fits.map { ($0.name, ($0.single.height * 2).rounded() / 2) }, uniquingKeysWith: max)
        }
        let smallest = heights(.xSmall)
        let standard = heights(.large)
        let largest = heights(.xxxLarge)
        let accessibility = heights(.accessibility3)
        // A widget may leave a line out at a larger size rather than cut it, so only the texts
        // drawn at both sizes are compared.
        let both = smallest.filter { largest[$0.key] != nil }
        if both.isEmpty { failures.append("\(name): no text was measured at both sizes") }
        for (text, height) in both.sorted(by: { $0.key < $1.key }) {
          let grown = largest[text] ?? 0
          if grown <= height {
            failures.append("\(name): the \(text) is \(height) pt at the smallest size, \(grown) at the largest")
          }
        }
        for (text, height) in accessibility.sorted(by: { $0.key < $1.key }) {
          if proseTexts.contains(text) {
            if let before = largest[text], height <= before {
              failures.append(
                "\(name): the \(text) is \(before) pt at the largest standard size and no taller "
                  + "at an accessibility size")
            }
          } else if let base = standard[text], height > base * WidgetTheme.maxTextScale + 1 {
            failures.append(
              "\(name): the \(text) is \(base) pt at the default size and \(height) at an "
                + "accessibility size, past \(WidgetTheme.maxTextScale) times")
          }
        }
      }
    }
    XCTAssert(failures.isEmpty, "Text that does not follow the text size as it should:\n" + failures.joined(separator: "\n"))
  }

  /// The probe has to see a cut when there is one, or the test above passes on nothing.
  func testTheProbeReportsACutAndPassesAWholeLine() {
    let long = String(repeating: "Mountain pass ", count: 6)
    let size = CGSize(width: 80, height: 120)
    func cuts(_ view: some View) -> [String] {
      cutOff(measure(view.font(.system(size: 20)).frame(width: 80, height: 120), size), in: size)
    }
    XCTAssertEqual(cuts(Text(long).measuredText("one line").lineLimit(1)).count, 1)
    XCTAssertEqual(cuts(Text(long).measuredText("two lines").lineLimit(2)).count, 1)
    XCTAssertEqual(cuts(Text("Ride").measuredText("short").lineLimit(1)), [])
    XCTAssertEqual(cuts(Text("Mountain pass").measuredText("wraps").lineLimit(3)), [])
    XCTAssertEqual(
      cuts(Text("1234567890").measuredText("scales").lineLimit(1).minimumScaleFactor(0.5)), [])
    XCTAssertEqual(
      cuts(Text("1234567890").measuredText("no scale").lineLimit(1)).count, 1)
    XCTAssertEqual(
      cuts(Text(long).measuredText("scales too far").lineLimit(1).minimumScaleFactor(0.5)).count,
      1)
    XCTAssertEqual(
      cuts(Text(long).measuredText("wraps and scales").lineLimit(4).minimumScaleFactor(0.25)), [])
    XCTAssertEqual(
      cuts(Text(long).measuredText("wraps, scales too far").lineLimit(4).minimumScaleFactor(0.9))
        .count, 1)
    XCTAssertEqual(
      cuts(
        Text(long).measuredText("scales, too few lines").lineLimit(2).minimumScaleFactor(0.5)
      ).count, 1)
    XCTAssertEqual(
      cuts(
        VStack(spacing: 0) {
          Color.clear.frame(height: 200)
          Text("Ride").measuredText("pushed out")
        }
      ).count, 1)
    XCTAssertEqual(cuts(Color.clear), ["no text was measured"])
  }

  /// Scenario: the gallery, and the home screen while a widget loads, draw each widget from its
  /// provider's placeholder, which WidgetKit redacts into the widget's shape.
  ///
  /// Expected behaviour: every placeholder carries the sample library, so every widget draws its
  /// own shape at every family rather than the open-the-app prompt.
  func testEveryPlaceholderDrawsTheSampleLibrary() {
    let all: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
    var placeholders: [(String, WidgetSnapshot?, [WidgetFamily], (WidgetFamily) -> AnyView)] = []
    let summary = VeloqProvider.placeholderEntry()
    placeholders.append(
      ("summary", summary.snapshot, all, {
        AnyView(VeloqWidgetEntryView(entry: summary, family: $0))
      }))
    let activity = LatestActivityProvider.placeholderEntry()
    placeholders.append(
      ("activity", activity.snapshot, [.systemSmall, .systemMedium], {
        AnyView(LatestActivityView(entry: activity, family: $0))
      }))
    let insights = InsightsProvider.placeholderEntry()
    placeholders.append(
      ("insights", insights.snapshot, all, {
        AnyView(InsightsWidgetView(entry: insights, family: $0))
      }))
    let strength = StrengthProvider.placeholderEntry()
    placeholders.append(
      ("strength", strength.snapshot, all, {
        AnyView(StrengthWidgetView(entry: strength, family: $0))
      }))
    if #available(iOS 17.0, *) {
      let summary = VeloqConfigProvider.placeholderEntry()
      placeholders.append(
        ("summary-configurable", summary.snapshot, all, {
          AnyView(VeloqWidgetEntryView(entry: summary, family: $0))
        }))
      let insights = InsightsConfigProvider.placeholderEntry()
      placeholders.append(
        ("insights-configurable", insights.snapshot, all, {
          AnyView(InsightsWidgetView(entry: insights, family: $0))
        }))
      let strength = StrengthConfigProvider.placeholderEntry()
      placeholders.append(
        ("strength-configurable", strength.snapshot, all, {
          AnyView(StrengthWidgetView(entry: strength, family: $0))
        }))
    }

    var failures: [String] = []
    for (name, snapshot, families, draw) in placeholders {
      if WidgetSnapshot.isEmpty(snapshot) {
        failures.append("\(name): the placeholder carries no library")
      }
      for family in families {
        let size = boxes(family)[0].size
        let placed = draw(family)
          .padding(contentMargin)
          .frame(width: size.width, height: size.height)
        if measure(placed, size).contains(where: { $0.name == "empty title" }) {
          failures.append("\(name)-\(familyName(family)): draws the open-the-app prompt")
        }
      }
    }
    XCTAssert(failures.isEmpty, failures.joined(separator: "\n"))
  }

  /// Scenario: a screen reader reaches each widget the sample library draws. The arrow beside a
  /// metric is coloured by its verdict, the charts, the route and the body are drawn and an
  /// insight's tone is a coloured dot, so none of them says anything unless it is given words.
  ///
  /// Expected behaviour: every one of them is drawn with the words the snapshot carries for it,
  /// and none reaches the screen reader empty.
  func testEveryMarkAWidgetDrawsSaysWhatItShows() throws {
    let snapshot = try self.snapshot("demo")
    var failures: [String] = []
    for widget in widgets where widget.name != "record" && widget.name != "strength-empty" {
      for family in widget.families {
        let name = "\(widget.name)-\(familyName(family))"
        let marks = spokenMarks(
          widget.draw(snapshot, family, Date()).padding(contentMargin), boxes(family)[0].size)
        for mark in marks where mark.label.isEmpty {
          failures.append("\(name): the \(mark.name) says nothing")
        }
        let missing = expectedMarks(widget.name, family).subtracting(marks.map(\.name))
        failures += missing.sorted().map { "\(name): draws no spoken \($0)" }
      }
    }
    XCTAssert(failures.isEmpty, "Marks without words:\n" + failures.joined(separator: "\n"))
  }

  /// The probe has to see a mark with no words, or the test above passes on nothing.
  func testTheProbeReportsAMarkWithNoWords() {
    let size = CGSize(width: 80, height: 80)
    XCTAssertEqual(
      spokenMarks(Circle().spoken("tone", nil), size), [SpokenMark(name: "tone", label: "")])
    XCTAssertEqual(
      spokenMarks(Circle().spoken("tone", "Record"), size),
      [SpokenMark(name: "tone", label: "Record")])
    XCTAssertEqual(spokenMarks(Circle(), size), [])
  }

  /// What each widget draws from the sample library that a screen reader cannot read off a text:
  /// the Last activity widget's small size leads with its comparison and leaves the name, the
  /// record mark beside it and the route out. A Summary placed on another hero draws the same
  /// marks as the default one.
  private func expectedMarks(_ widget: String, _ family: WidgetFamily) -> Set<String> {
    switch (widget.hasPrefix("summary") ? "summary" : widget, family) {
    case ("summary", .systemSmall): return ["hero", "chart"]
    case ("summary", .systemMedium): return ["hero", "chart", "metric"]
    case ("summary", _): return ["hero", "chart", "metric", "form chart"]
    case ("activity", .systemSmall): return []
    case ("activity", _): return ["route", "record"]
    case ("insights", _): return ["tone"]
    default: return ["body"]
    }
  }

  private final class Marks {
    var marks: [SpokenMark] = []
  }

  private func spokenMarks(_ view: some View, _ size: CGSize) -> [SpokenMark] {
    let log = Marks()
    let root = view
      .environment(\.measuresText, true)
      .backgroundPreferenceValue(SpokenMarkKey.self) { marks in
        let _ = (log.marks = marks)
        Color.clear
      }
    _ = ImageRenderer(content: root.frame(width: size.width, height: size.height)).uiImage
    return log.marks
  }

  // MARK: - drawing

  /// The snapshot with its calendar month emptied and worded as the longest words a locale gives
  /// a window with no strength sessions.
  nonisolated private static func emptyStrengthMonth(_ snapshot: WidgetSnapshot) -> WidgetSnapshot {
    guard
      let data = try? JSONEncoder().encode(snapshot),
      var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      var strength = json["strength"] as? [String: Any],
      var windows = strength["windows"] as? [String: Any],
      var month = windows["month"] as? [String: Any]
    else { return snapshot }
    month["muscles"] = []
    month["top"] = []
    month["emptyText"] = "Aucune séance de musculation sur les dernières 6 mois"
    windows["month"] = month
    strength["windows"] = windows
    json["strength"] = strength
    guard let emptied = try? JSONSerialization.data(withJSONObject: json) else { return snapshot }
    return (try? JSONDecoder().decode(WidgetSnapshot.self, from: emptied)) ?? snapshot
  }

  private func snapshot(_ fixture: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: fixture, withExtension: "json", subdirectory: "fixtures"),
      "no fixture \(fixture).json")
    return try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
  }

  private func capturesDirectory() throws -> URL {
    let path =
      ProcessInfo.processInfo.environment["WIDGET_CAPTURES_DIR"]
      ?? NSTemporaryDirectory() + "widget-captures"
    let url = URL(fileURLWithPath: path, isDirectory: true)
    try? FileManager.default.removeItem(at: url)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func familyName(_ family: WidgetFamily) -> String {
    switch family {
    case .systemSmall: return "small"
    case .systemMedium: return "medium"
    case .systemLarge: return "large"
    default: return "\(family)"
    }
  }

  /// Draws one placement on the widget's own ground, or in accented mode on none, saves it, and
  /// lists what it cuts off and which expected texts it does not draw.
  private func capture(
    _ name: String, _ widget: AnyView, _ snapshot: WidgetSnapshot, _ size: CGSize,
    _ mode: Mode, _ out: URL, _ expected: [String], textSize: DynamicTypeSize = .large
  ) -> [String] {
    // The tinted and clear Home Screens draw over a dark ground.
    let scheme: ColorScheme = mode == .light ? .light : .dark
    let palette = WidgetPalette.resolve(snapshot, scheme)
    let ground =
      mode == .accented
      ? [Color.clear]
      : name.hasPrefix("record-")
        ? (scheme == .dark
          ? [WidgetTheme.Record.Dark.gradientStart, WidgetTheme.Record.Dark.gradientEnd]
          : [WidgetTheme.Record.Light.gradientStart, WidgetTheme.Record.Light.gradientEnd])
        : [palette.surface, palette.background]
    let placed = widget
      .padding(contentMargin)
      .frame(width: size.width, height: size.height)
      .background(LinearGradient(colors: ground, startPoint: .top, endPoint: .bottom))
      .clipShape(RoundedRectangle(cornerRadius: WidgetTheme.Layout.radius * 1.4))
      .environment(\.colorScheme, scheme)
      .environment(\.widgetRenderingMode, mode == .accented ? .accented : .fullColor)
      .environment(\.dynamicTypeSize, textSize)
    let drawn =
      mode == .accented
      ? AnyView(
        ZStack {
          // A backdrop only so the PNG can be looked at: the widget itself draws on none.
          WidgetTheme.Dark.background
          placed.hidden()
          Color.white.mask(placed)
        }
        .frame(width: size.width, height: size.height))
      : AnyView(placed)
    let fits = measure(drawn, size, save: out.appendingPathComponent("\(name).png"))
    var found = cutOff(fits, in: size).map { "\(name): \($0)" }
    // Form figures are coloured by their zone, so wherever they are drawn the zone is in words too.
    if snapshot.impact?.formAfterZoneText != nil, fits.contains(where: { $0.name == "form after" }),
      !fits.contains(where: { $0.name == "form zone" })
    {
      found.append("\(name): draws the form figures and not their zone")
    }
    for text in expected where !fits.contains(where: { $0.name == text }) {
      found.append("\(name): draws no \(text)")
    }
    return found
  }

  private final class Log {
    var fits: [TextFit] = []
  }

  private func measure(_ view: some View, _ size: CGSize, save: URL? = nil) -> [TextFit] {
    let log = Log()
    let root = view
      .coordinateSpace(name: TextFit.space)
      .environment(\.measuresText, true)
      .backgroundPreferenceValue(TextFitKey.self) { fits in
        let _ = (log.fits = fits)
        Color.clear
      }
    let renderer = ImageRenderer(content: root.frame(width: size.width, height: size.height))
    renderer.scale = 3
    let image = renderer.uiImage
    if let save, let data = image?.pngData() {
      try? data.write(to: save)
    }
    return log.fits
  }

  // MARK: - judging

  /// Why each measured text is not shown whole. A text that may shrink fits when its one line
  /// at the smallest scale it allows is as wide as its box; every other text fits when all its
  /// lines at full size are as tall as its box. Every widget draws some text, so measuring none
  /// means the probe did not run. Half a point is rounding.
  private func cutOff(_ fits: [TextFit], in size: CGSize) -> [String] {
    if fits.isEmpty { return ["no text was measured"] }
    let slack: CGFloat = 0.5
    let widget = CGRect(origin: .zero, size: size).insetBy(dx: -slack, dy: -slack)
    var found: [String] = []
    var seen = Set<String>()
    for fit in fits {
      let key = "\(fit.name)@\(Int(fit.frame.minX)),\(Int(fit.frame.minY))"
      if !seen.insert(key).inserted { continue }
      let at = "\(fit.name) at \(Int(fit.frame.minX)),\(Int(fit.frame.minY))"
      let box = fit.frame
      if box.width <= slack || box.height <= slack {
        found.append("\(at) has no room to lay out")
        continue
      }
      if fit.minimumScaleFactor < 1, fit.lineLimit == 1 {
        if fit.single.width * fit.minimumScaleFactor > box.width + slack {
          found.append(
            "\(at) is cut even at \(Int(fit.minimumScaleFactor * 100)) %: needs "
              + "\(Int(fit.single.width.rounded(.up))) pt across, has \(Int(box.width))")
        }
      } else if fit.minimumScaleFactor < 1 {
        let lines = Int((fit.shrunk.height / max(fit.single.height, 1)).rounded())
        let down = fit.shrunk.height * fit.minimumScaleFactor
        if let limit = fit.lineLimit, lines > limit {
          found.append(
            "\(at) is cut even at \(Int(fit.minimumScaleFactor * 100)) %: needs \(lines) lines, "
              + "has \(limit)")
        } else if down > box.height + slack {
          found.append(
            "\(at) is cut even at \(Int(fit.minimumScaleFactor * 100)) %: needs "
              + "\(Int(down.rounded(.up))) pt down at \(Int(box.width)) across, has "
              + "\(Int(box.height))")
        }
      } else if fit.wrapped.height > box.height + slack {
        found.append(
          "\(at) is cut: needs \(Int(fit.wrapped.height.rounded(.up))) pt down at "
            + "\(Int(box.width)) across, has \(Int(box.height))")
      }
      if !widget.contains(box) {
        found.append("\(at) leaves the widget")
      }
    }
    return found
  }
}
