import XCTest

@testable import VeloqWidget

/// Scenario: the Summary widget draws the trend the snapshot carries beside each number, the
/// direction the engine read off its own glyph.
///
/// Expected behaviour: up, down and flat draw the arrows the app draws beside the same number,
/// flat as a right arrow rather than a minus, and a direction this build does not know draws flat.
/// The verdict's variant keeps the same arrow.
final class TrendSymbolTests: XCTestCase {
  func testTheTrendArrowsAreTheEngineGlyphsWithFlatDrawnAsARightArrow() {
    XCTAssertEqual(trendSymbol("up", nil), "arrow.up")
    XCTAssertEqual(trendSymbol("down", nil), "arrow.down")
    XCTAssertEqual(trendSymbol("flat", nil), "arrow.right")
  }

  func testADirectionTheWidgetDoesNotKnowDrawsFlat() {
    XCTAssertEqual(trendSymbol("", nil), "arrow.right")
    XCTAssertEqual(trendSymbol("sideways", nil), "arrow.right")
  }

  func testAJudgedFlatKeepsTheRightArrow() {
    XCTAssertEqual(trendSymbol("flat", "improved"), "arrow.right.circle.fill")
    XCTAssertEqual(trendSymbol("flat", "declined"), "arrow.right.circle")
  }
}
