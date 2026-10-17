import UIKit
import XCTest

@testable import VeloqWidget

/// Scenario: a long press on the Veloq icon offers the athlete's recent sports, from the list the
/// Android launcher publishes as shortcuts.
///
/// Expected behaviour: one quick action per sport, in the list's order, titled with its label and
/// opening its recording link; each sport category draws its own symbol; an entry with no sport
/// or no link is dropped; and the empty list is the empty set that clears the menu.
final class RecordQuickActionsTests: XCTestCase {
  private let triathlon: [[String: String]] = [
    ["type": "Ride", "label": "Ride", "url": "veloq://recording/Ride?from=quickstart", "glyph": "ride"],
    ["type": "Run", "label": "Run", "url": "veloq://recording/Run?from=quickstart", "glyph": "run"],
    ["type": "Swim", "label": "Swim", "url": "veloq://recording/Swim?from=quickstart", "glyph": "swim"],
  ]

  func testOneItemPerSportOpeningItsRecordingLink() {
    let items = RecordQuickActions.items(triathlon)
    XCTAssertEqual(items.map(\.localizedTitle), ["Ride", "Run", "Swim"])
    XCTAssertEqual(
      items.map { RecordQuickActions.url(of: $0)?.absoluteString },
      triathlon.map { $0["url"] })
  }

  func testTheEmptyListClearsTheMenu() {
    XCTAssertTrue(RecordQuickActions.items([]).isEmpty)
  }

  func testAnEntryWithNoSportOrNoLinkIsDropped() {
    let items = RecordQuickActions.items([
      ["type": " ", "label": "Blank", "url": "veloq://recording/Blank"],
      ["type": "Row", "label": "Row", "url": ""],
      ["type": "Hike", "label": "", "url": "veloq://recording/Hike?from=quickstart", "glyph": "foot"],
    ])
    XCTAssertEqual(items.map(\.localizedTitle), ["Hike"])
  }

  func testEachFamilyDrawsItsOwnSymbol() {
    let families = ["ride", "winter", "run", "water", "foot", "strength", "other"]
    let symbols = families.map { RecordQuickActions.symbol($0) }
    XCTAssertEqual(Set(symbols).count, families.count)
    for symbol in symbols {
      XCTAssertNotNil(UIImage(systemName: symbol), symbol)
    }
  }

  func testAnUnknownFamilyDrawsTheCatchAll() {
    XCTAssertEqual(RecordQuickActions.symbol("underwater-basket"), RecordQuickActions.symbol("other"))
    XCTAssertEqual(RecordQuickActions.symbol(nil), RecordQuickActions.symbol("other"))
  }

  func testAnItemThisListDidNotPublishOpensNothing() {
    let foreign = UIApplicationShortcutItem(type: "elsewhere", localizedTitle: "Elsewhere")
    XCTAssertNil(RecordQuickActions.url(of: foreign))
  }
}
