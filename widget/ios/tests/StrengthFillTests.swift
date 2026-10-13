import SwiftUI
import UIKit
import XCTest

@testable import VeloqWidget

/// Scenario: the Strength widget's body is drawn on a tinted or clear Home Screen, which draws
/// every part in one colour and keeps only its alpha.
///
/// Expected behaviour: in the accented mode every trained part takes one colour, at an alpha
/// that rises strictly with its shade, and an untrained part sits below the lightest shade; in
/// full colour each shade keeps its own opaque ramp colour.
final class StrengthFillTests: XCTestCase {
  private let palettes = [WidgetPalette.resolve(nil, .light), WidgetPalette.resolve(nil, .dark)]

  private func alpha(_ color: Color) -> CGFloat {
    UIColor(color).cgColor.alpha
  }

  private func opaque(_ color: Color) -> UIColor {
    UIColor(color).withAlphaComponent(1)
  }

  func testAccentedAlphaRisesStrictlyWithTheShade() {
    for palette in palettes {
      let alphas = (1...palette.strengthRamp.count).map {
        alpha(palette.strengthFill($0, accented: true))
      }
      for (lower, higher) in zip(alphas, alphas.dropFirst()) {
        XCTAssertLessThan(lower, higher, "\(alphas)")
      }
      XCTAssertEqual(alphas.last ?? 0, 1, accuracy: 0.001)
    }
  }

  func testAnUntrainedPartSitsBelowTheLightestShade() {
    for palette in palettes {
      let lightest = alpha(palette.strengthFill(1, accented: true))
      for untrained in [nil, 0, -1] as [Int?] {
        let fill = alpha(palette.strengthFill(untrained, accented: true))
        XCTAssertGreaterThan(fill, 0, "\(String(describing: untrained))")
        XCTAssertLessThan(fill, lightest, "\(String(describing: untrained))")
      }
    }
  }

  func testAccentedTrainedPartsShareOneColour() {
    for palette in palettes {
      let colours = (1...palette.strengthRamp.count).map {
        opaque(palette.strengthFill($0, accented: true))
      }
      XCTAssertTrue(colours.allSatisfy { $0 == colours[0] }, "\(colours)")
    }
  }

  func testAShadePastTheRampTakesTheTopAlpha() {
    for palette in palettes {
      let top = palette.strengthRamp.count
      XCTAssertEqual(
        alpha(palette.strengthFill(top + 3, accented: true)),
        alpha(palette.strengthFill(top, accented: true)), accuracy: 0.001)
    }
  }

  func testFullColourKeepsTheOpaqueRamp() {
    for palette in palettes {
      for (index, ramp) in palette.strengthRamp.enumerated() {
        let fill = palette.strengthFill(index + 1, accented: false)
        XCTAssertEqual(alpha(fill), 1, accuracy: 0.001)
        XCTAssertEqual(opaque(fill), opaque(ramp))
      }
      XCTAssertEqual(opaque(palette.strengthFill(nil, accented: false)), opaque(palette.bodyFill))
      XCTAssertEqual(alpha(palette.strengthFill(nil, accented: false)), 1, accuracy: 0.001)
    }
  }
}
