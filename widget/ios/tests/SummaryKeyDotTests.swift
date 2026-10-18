import SwiftUI
import XCTest

@testable import VeloqWidget

/// Scenario: a Summary value is primary text, and the measure it belongs to is said by a dot
/// beside it in that measure's colour.
///
/// Expected behaviour: fitness and fatigue take their series colours and form takes the fill of
/// the zone it sits in. An entry with no measure colour, form with no zone, and a zone this build
/// does not know draw no dot rather than a guessed colour.
final class SummaryKeyDotTests: XCTestCase {
  private let palette = WidgetPalette.lightFallback

  func testFitnessAndFatigueTakeTheirSeriesColours() {
    XCTAssertEqual(palette.keyColor("blue", formZone: nil), palette.blue)
    XCTAssertEqual(palette.keyColor("fatigue", formZone: "optimal"), palette.fatigue)
  }

  func testFormTakesTheFillOfItsZone() {
    XCTAssertEqual(palette.keyColor("formZone", formZone: "highRisk"), palette.formHighRisk)
    XCTAssertEqual(palette.keyColor("formZone", formZone: "optimal"), palette.formOptimal)
    XCTAssertEqual(palette.keyColor("formZone", formZone: "greyZone"), palette.formGreyZone)
    XCTAssertEqual(palette.keyColor("formZone", formZone: "fresh"), palette.formFresh)
    XCTAssertEqual(palette.keyColor("formZone", formZone: "transition"), palette.formTransition)
  }

  func testNoMeasureColourDrawsNoDot() {
    XCTAssertNil(palette.keyColor("default", formZone: "optimal"))
    XCTAssertNil(palette.keyColor("formZone", formZone: nil))
    XCTAssertNil(palette.keyColor("formZone", formZone: "sideways"))
  }
}
