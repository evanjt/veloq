import XCTest

@testable import VeloqWidget

/// Scenario: the Summary widget draws a verdict and a form zone on a Home Screen that may draw
/// it in one colour.
///
/// Expected behaviour: the verdict changes the trend symbol and not only its colour, so a rise
/// judged worse reads apart from a rise judged better; and the Form entry on the supporting row
/// carries its zone in words.
final class SummaryWidgetModelTests: XCTestCase {
  private func snapshot(_ fixture: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: fixture, withExtension: "json", subdirectory: "fixtures"))
    return try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
  }

  func testTheVerdictChangesTheSymbolWhateverTheDirection() {
    for dir in ["up", "down", "flat"] {
      let symbols = ["improved", "declined", "flat"].map { trendSymbol(dir, $0) }
      XCTAssertEqual(Set(symbols).count, 3, "\(dir): \(symbols)")
    }
  }

  func testTheDirectionStillChangesTheSymbol() {
    for verdict in ["improved", "declined", "flat"] {
      let symbols = ["up", "down", "flat"].map { trendSymbol($0, verdict) }
      XCTAssertEqual(Set(symbols).count, 3, "\(verdict): \(symbols)")
    }
  }

  func testNoVerdictAndAnUnknownVerdictDrawAsFlat() {
    XCTAssertEqual(trendSymbol("up", nil), trendSymbol("up", "flat"))
    XCTAssertEqual(trendSymbol("up", "moved"), trendSymbol("up", "flat"))
  }

  func testTheFormEntryOnTheRowCarriesItsZoneWord() throws {
    let snapshot = try self.snapshot("demo")
    let content = SummaryWidgetModel.content(
      snapshot, placement: SummaryPlacement(hero: "fitness"), size: .medium)
    let form = try XCTUnwrap(content.supporting.first { $0.entry.id == "form" })
    XCTAssertEqual(form.caption, snapshot.display.formZone)
    XCTAssertNotNil(form.caption)
    for other in content.supporting where other.entry.id != "form" {
      XCTAssertNil(other.caption, other.entry.id)
    }
  }

  func testAFormHeroKeepsItsZoneOnTheHeroLineAndTheRowCarriesNone() throws {
    let snapshot = try self.snapshot("demo")
    let content = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .large)
    XCTAssertEqual(content.hero.id, "form")
    XCTAssertEqual(content.heroLine, snapshot.display.formZone)
    XCTAssertTrue(content.supporting.allSatisfy { $0.caption == nil })
  }
}
