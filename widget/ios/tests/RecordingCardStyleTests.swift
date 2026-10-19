import SwiftUI
import UIKit
import XCTest

@testable import VeloqWidget

/// Scenario: the recording card sits on a translucent black tint over whatever wallpaper the
/// reader chose, in either system appearance, and its compact clock sits in the Dynamic Island
/// beside the camera.
///
/// Expected behaviour: the secondary line clears WCAG AA 4.5:1 on the tint over a white
/// wallpaper, the worst ground, in light and dark; paused and stale are never the gold that marks
/// a personal record; the compact clock's frame holds the longest clock a ride reaches.
@MainActor
final class RecordingCardStyleTests: XCTestCase {
  nonisolated override func setUp() {
    super.setUp()
    _ = BundledFace.registered
  }

  private let schemes: [UIUserInterfaceStyle] = [.light, .dark]

  func testTheSecondaryLineClearsAAOnTheTintOverAWhiteWallpaper() {
    for scheme in schemes {
      let tint = rgba(RecordingCardStyle.tint, scheme)
      let ground = over(tint, white)
      let ink = over(rgba(RecordingCardStyle.secondaryText, scheme), ground)
      let ratio = contrast(ink, ground)
      XCTAssertGreaterThanOrEqual(
        ratio, 4.5, "secondary text is \(String(format: "%.2f", ratio)):1 in \(name(scheme))")
    }
  }

  func testThePrimaryLineClearsAAOnTheTintOverAWhiteWallpaper() {
    for scheme in schemes {
      let ground = over(rgba(RecordingCardStyle.tint, scheme), white)
      let ink = over(rgba(WidgetTheme.Record.foreground, scheme), ground)
      XCTAssertGreaterThanOrEqual(contrast(ink, ground), 4.5, name(scheme))
    }
  }

  func testPausedAndStaleAreNotTheRecordGold() {
    let golds = [rgba(WidgetTheme.Light.gold, .light), rgba(WidgetTheme.Dark.gold, .dark)]
    for scheme in schemes {
      for gold in golds {
        XCTAssertNotEqual(rgba(RecordingCardStyle.paused, scheme), gold, name(scheme))
        XCTAssertNotEqual(rgba(RecordingCardStyle.stale, scheme), gold, name(scheme))
      }
    }
  }

  /// The island is always black, so a glyph there holds 3:1 against black.
  func testPausedAndStaleGlyphsHoldOnTheIsland() {
    let black = RGBA(r: 0, g: 0, b: 0, a: 1)
    for scheme in schemes {
      XCTAssertGreaterThanOrEqual(contrast(over(rgba(RecordingCardStyle.paused, scheme), black), black), 3)
      XCTAssertGreaterThanOrEqual(contrast(over(rgba(RecordingCardStyle.stale, scheme), black), black), 3)
    }
  }

  /// A ride past ten hours reads two hour digits, the widest clock the timer draws.
  func testTheCompactClockFrameHoldsTheWidestClock() {
    let width = RecordingCardStyle.compactClockWidth
    XCTAssert(width.isFinite, "the compact clock has no frame, so the island widens with it")
    for clock in ["0:00", "59:59", "9:59:59", "10:00:00", "99:59:59"] {
      let text = Text(clock).font(RecordingCardStyle.clockFont(WidgetTheme.TypeScale.label))
      let needs = UIHostingController(rootView: text.fixedSize())
        .sizeThatFits(in: CGSize(width: 1000, height: 1000)).width
      XCTAssertLessThanOrEqual(needs, width + 0.5, "\(clock) needs \(needs) pt, has \(width)")
    }
  }

  // MARK: - colour arithmetic

  private struct RGBA: Equatable {
    let r: Double
    let g: Double
    let b: Double
    let a: Double
  }

  private let white = RGBA(r: 1, g: 1, b: 1, a: 1)

  private func name(_ scheme: UIUserInterfaceStyle) -> String {
    scheme == .dark ? "dark" : "light"
  }

  private func rgba(_ color: Color, _ scheme: UIUserInterfaceStyle) -> RGBA {
    let resolved = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: scheme))
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    resolved.getRed(&r, green: &g, blue: &b, alpha: &a)
    let round = { (value: CGFloat) in (Double(value) * 1000).rounded() / 1000 }
    return RGBA(r: round(r), g: round(g), b: round(b), a: round(a))
  }

  /// Source over: `top` laid on an opaque `bottom`.
  private func over(_ top: RGBA, _ bottom: RGBA) -> RGBA {
    let mix = { (t: Double, u: Double) in t * top.a + u * (1 - top.a) }
    return RGBA(r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1)
  }

  private func luminance(_ c: RGBA) -> Double {
    let linear = { (v: Double) in v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b)
  }

  private func contrast(_ a: RGBA, _ b: RGBA) -> Double {
    let (la, lb) = (luminance(a), luminance(b))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
  }
}
