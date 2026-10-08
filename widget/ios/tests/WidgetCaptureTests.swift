import SwiftUI
import WidgetKit
import XCTest

@testable import VeloqWidget

/// Scenario: every widget is drawn at every family it supports, in the smallest and the largest
/// box an iPhone gives that family, in light and dark, with the sample library and with the
/// longest words the locales have.
///
/// Expected behaviour: no text is truncated, squeezed to fewer lines than it needs or pushed out
/// of the widget. Every placement is saved as a PNG under `WIDGET_CAPTURES_DIR`, so a failure can
/// be looked at rather than only read.
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
  /// 375 by 667 and 430 by 932 points, from the platform's table of widget sizes.
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
      ]
    case .systemMedium:
      return [
        Box(screen: "375", size: CGSize(width: 321, height: 148)),
        Box(screen: "430", size: CGSize(width: 364, height: 170)),
      ]
    default:
      return [
        Box(screen: "375", size: CGSize(width: 321, height: 324)),
        Box(screen: "430", size: CGSize(width: 364, height: 382)),
      ]
    }
  }

  /// The margin the Home Screen keeps inside a widget since iOS 17, which none of these widgets
  /// turns off. Before iOS 17 there is none, so this is the tighter of the two.
  private let contentMargin: CGFloat = 16

  func testEveryWidgetDrawsEveryTextWholeAtEveryFamily() throws {
    let out = try capturesDirectory()
    var failures: [String] = []
    for fixture in ["demo", "long-text"] {
      let snapshot = try self.snapshot(fixture)
      for widget in widgets {
        for family in widget.families {
          for box in boxes(family) {
            for scheme in [ColorScheme.light, .dark] {
              let name = [
                widget.name, familyName(family), box.screen, fixture,
                scheme == .dark ? "dark" : "light",
              ].joined(separator: "-")
              let view = widget.draw(snapshot, family, Date())
              failures += capture(name, view, snapshot, box.size, scheme, out)
            }
          }
        }
      }
    }
    XCTAssert(
      failures.isEmpty,
      "Cut-off text in \(failures.count) places, captures in \(out.path):\n"
        + failures.joined(separator: "\n"))
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
      cuts(
        VStack(spacing: 0) {
          Color.clear.frame(height: 200)
          Text("Ride").measuredText("pushed out")
        }
      ).count, 1)
    XCTAssertEqual(cuts(Color.clear), ["no text was measured"])
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

  /// Draws one placement on the widget's own ground, saves it, and lists what it cuts off.
  private func capture(
    _ name: String, _ widget: AnyView, _ snapshot: WidgetSnapshot, _ size: CGSize,
    _ scheme: ColorScheme, _ out: URL
  ) -> [String] {
    let palette = WidgetPalette.resolve(snapshot, scheme)
    let ground =
      name.hasPrefix("record-")
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
    let fits = measure(placed, size, save: out.appendingPathComponent("\(name).png"))
    return cutOff(fits, in: size).map { "\(name): \($0)" }
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
