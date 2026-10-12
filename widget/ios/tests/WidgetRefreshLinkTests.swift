import XCTest

@testable import VeloqWidget

/// Scenario: an iOS widget cannot pull new numbers itself, because the engine does not fit in
/// the extension's memory beside the widget, so its refresh control opens the app, whose
/// foreground sync rewrites the snapshot.
///
/// Expected behaviour: the control shows only where iOS lets a widget hold a link of its own and
/// the numbers are the athlete's own, it says in the snapshot's words that it opens the app, and
/// a snapshot written before those words existed draws no control rather than one that claims to
/// refresh.
final class WidgetRefreshLinkTests: XCTestCase {
  private func snapshot(_ fixture: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: fixture, withExtension: "json", subdirectory: "fixtures"))
    return try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
  }

  /// The fixture as a build from before the control's words would have written it.
  private func withoutTheLabel(_ fixture: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: fixture, withExtension: "json", subdirectory: "fixtures"))
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    var display = try XCTUnwrap(json["display"] as? [String: Any])
    display.removeValue(forKey: "openToRefreshLabel")
    json["display"] = display
    return try JSONDecoder().decode(
      WidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
  }

  func testAnAthletesOwnNumbersCarryTheControlInTheSnapshotsWords() throws {
    let snapshot = try self.snapshot("no-wellness")

    let link = try XCTUnwrap(WidgetRefreshLink.link(snapshot, hasRoom: true))

    XCTAssertEqual(link.label, "Open Veloq to refresh")
    XCTAssertEqual(link.label, snapshot.display.openToRefreshLabel)
    XCTAssertEqual(link.url, URL(string: "veloq://"))
  }

  func testTheLongestWordsAnyLocaleHasAreTheControlsToo() throws {
    let snapshot = try self.snapshot("long-text")

    let link = try XCTUnwrap(WidgetRefreshLink.link(snapshot, hasRoom: true))

    XCTAssertEqual(link.label, snapshot.display.openToRefreshLabel)
    XCTAssertNotEqual(link.label, "Open Veloq to refresh")
  }

  func testASizeWithNoRoomForALinkDrawsNoControl() throws {
    XCTAssertNil(WidgetRefreshLink.link(try snapshot("no-wellness"), hasRoom: false))
  }

  func testTheSampleLibraryDrawsNoControl() throws {
    XCTAssertNil(WidgetRefreshLink.link(try snapshot("demo"), hasRoom: true))
  }

  func testAnEmptyLibraryAndNoSnapshotDrawNoControl() throws {
    XCTAssertNil(WidgetRefreshLink.link(try snapshot("empty"), hasRoom: true))
    XCTAssertNil(WidgetRefreshLink.link(nil, hasRoom: true))
  }

  func testASnapshotFromBeforeTheWordsDrawsNoControl() throws {
    XCTAssertNil(WidgetRefreshLink.link(try withoutTheLabel("no-wellness"), hasRoom: true))
  }
}
