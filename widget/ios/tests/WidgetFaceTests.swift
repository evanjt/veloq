import SwiftUI
import UIKit
import XCTest

@testable import VeloqWidget

/// Scenario: a widget asks for its face by PostScript name, and iOS draws the system face for a
/// name it cannot find, with nothing to say so.
///
/// Expected behaviour: every name a weight draws resolves to the bundled file of that name, a
/// weight draws the nearest of the three files, and the reader's Bold Text draws one file heavier.
final class WidgetFaceTests: XCTestCase {
  override func setUp() {
    super.setUp()
    _ = BundledFace.registered
  }

  func testEveryWeightResolvesToTheBundledFileOfThatName() {
    for weight in [Font.Weight.ultraLight, .regular, .medium, .semibold, .bold, .black] {
      for boldText in [false, true] {
        let name = WidgetTheme.Face.name(weight, boldText: boldText)
        XCTAssertEqual(UIFont(name: name, size: 12)?.fontName, name, "\(weight), bold \(boldText)")
      }
    }
  }

  func testAWeightDrawsTheNearestFile() {
    XCTAssertEqual(WidgetTheme.Face.name(.light), WidgetTheme.Face.regular)
    XCTAssertEqual(WidgetTheme.Face.name(.regular), WidgetTheme.Face.regular)
    XCTAssertEqual(WidgetTheme.Face.name(.medium), WidgetTheme.Face.semibold)
    XCTAssertEqual(WidgetTheme.Face.name(.semibold), WidgetTheme.Face.semibold)
    XCTAssertEqual(WidgetTheme.Face.name(.bold), WidgetTheme.Face.bold)
    XCTAssertEqual(WidgetTheme.Face.name(.heavy), WidgetTheme.Face.bold)
  }

  func testBoldTextDrawsOneFileHeavierAndBoldStaysBold() {
    XCTAssertEqual(WidgetTheme.Face.name(.regular, boldText: true), WidgetTheme.Face.semibold)
    XCTAssertEqual(WidgetTheme.Face.name(.semibold, boldText: true), WidgetTheme.Face.bold)
    XCTAssertEqual(WidgetTheme.Face.name(.bold, boldText: true), WidgetTheme.Face.bold)
  }

  /// The font a widget line is given is the face itself, not the system face it falls back to.
  func testTheWidgetFontDrawsTheFace() {
    let font = UIFont(name: WidgetTheme.Face.name(.semibold), size: WidgetTheme.TypeScale.label)
    XCTAssertEqual(font?.familyName, "Manrope")
  }
}
