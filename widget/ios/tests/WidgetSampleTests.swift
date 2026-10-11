import XCTest

@testable import VeloqWidget

/// Scenario: the widget gallery asks for a snapshot before the app has written one, or while the
/// athlete's library is empty, and the home screen asks for one once the app has written theirs.
///
/// Expected behaviour: the sample library decodes, the gallery draws it in place of an absent or
/// empty snapshot, and every other request draws the athlete's own snapshot, even an empty one.
final class WidgetSampleTests: XCTestCase {
  private func fixture(_ name: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "fixtures"))
    return try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
  }

  func testTheSampleIsALibraryWithEveryWidgetsData() throws {
    let sample = try XCTUnwrap(WidgetSample.snapshot, "the generated sample does not decode")
    XCTAssertFalse(WidgetSnapshot.isEmpty(sample))
    XCTAssertNotNil(sample.latest)
    XCTAssertFalse(sample.insights?.isEmpty ?? true)
    XCTAssertNotNil(sample.strength)
  }

  func testTheGalleryDrawsTheSampleOnlyWhileTheAthleteHasNothingToShow() throws {
    let own = try fixture("long-text")
    let empty = try fixture("empty")
    let sample = try XCTUnwrap(WidgetSample.snapshot)
    let sampleLabel = try XCTUnwrap(sample.display.demoLabel)
    XCTAssertNil(own.display.demoLabel)

    XCTAssertEqual(
      WidgetSample.snapshot(stored: nil, isPreview: true)?.display.demoLabel, sampleLabel)
    XCTAssertEqual(
      WidgetSample.snapshot(stored: empty, isPreview: true)?.display.demoLabel, sampleLabel)
    XCTAssertEqual(
      WidgetSample.snapshot(stored: own, isPreview: true)?.latest?.name, own.latest?.name)

    XCTAssertNil(WidgetSample.snapshot(stored: nil, isPreview: false))
    XCTAssertEqual(WidgetSample.snapshot(stored: empty, isPreview: false)?.emptyLibrary, true)
    XCTAssertEqual(
      WidgetSample.snapshot(stored: own, isPreview: false)?.latest?.name, own.latest?.name)
  }
}
