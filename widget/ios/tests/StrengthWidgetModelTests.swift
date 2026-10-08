import XCTest

@testable import VeloqWidget

/// Scenario: the Strength widget is placed at each size on either window, over a snapshot the
/// engine composed, one whose window holds no sessions, and one written before the strength block.
///
/// Expected behaviour: small draws the front, medium the front and back, large both and the
/// window's top rows; the month choice draws the month; a window with words draws them and no
/// body; a snapshot with no block draws nothing of its own.
final class StrengthWidgetModelTests: XCTestCase {
  private func snapshot(_ fixture: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: fixture, withExtension: "json", subdirectory: "fixtures"))
    return try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
  }

  /// The demo fixture with its strength block replaced, or removed when `strength` is nil.
  private func snapshot(strength: Any?) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: "demo", withExtension: "json", subdirectory: "fixtures"))
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    json["strength"] = strength
    return try JSONDecoder().decode(
      WidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
  }

  private func window(_ label: String, shades: [(String, Int)], empty: String? = nil)
    -> [String: Any]
  {
    [
      "label": label, "activityCount": empty == nil ? 2 : 0, "totalSets": 9, "owedCount": 0,
      "maxWeightedSets": 5.0,
      "muscles": shades.map { ["slug": $0.0, "shade": $0.1] },
      "top": shades.map { ["slug": $0.0, "name": $0.0.capitalized, "setsText": "3 sets"] },
      "emptyText": empty ?? NSNull(),
    ]
  }

  private func block(last30: [String: Any], month: [String: Any], body: String = "male")
    -> [String: Any]
  {
    [
      "body": body, "url": "veloq://insights?tab=strength&period=1m",
      "windows": ["last30": last30, "month": month],
    ]
  }

  func testEachSizeDrawsItsSidesAndOnlyLargeListsTheTopMuscles() throws {
    let demo = try snapshot("demo")
    let small = try XCTUnwrap(StrengthWidgetModel.content(demo, size: .small, choice: .last30))
    let medium = try XCTUnwrap(StrengthWidgetModel.content(demo, size: .medium, choice: .last30))
    let large = try XCTUnwrap(StrengthWidgetModel.content(demo, size: .large, choice: .last30))

    XCTAssertEqual(small.sides, [.front])
    XCTAssertEqual(medium.sides, [.front, .back])
    XCTAssertEqual(large.sides, [.front, .back])
    XCTAssertEqual(small.top.count, 0)
    XCTAssertEqual(medium.top.count, 0)
    XCTAssertEqual(
      large.top.map(\.slug), demo.strength?.windows.last30.top.map(\.slug))
    XCTAssertEqual(large.top.count, 4)
    XCTAssertEqual(large.url?.absoluteString, "veloq://insights?tab=strength&period=1m")
    XCTAssertNil(large.emptyText)
  }

  func testTheChoiceDrawsItsOwnWindow() throws {
    let both = try snapshot(
      strength: block(
        last30: window("1 month", shades: [("chest", 5), ("biceps", 2)]),
        month: window("March", shades: [("calves", 3)])))

    let last30 = try XCTUnwrap(StrengthWidgetModel.content(both, size: .large, choice: .last30))
    let month = try XCTUnwrap(StrengthWidgetModel.content(both, size: .large, choice: .month))

    XCTAssertEqual(last30.label, "1 month")
    XCTAssertEqual(last30.shades, ["chest": 5, "biceps": 2])
    XCTAssertEqual(month.label, "March")
    XCTAssertEqual(month.shades, ["calves": 3])
    XCTAssertEqual(month.top.map(\.slug), ["calves"])
  }

  func testAWindowWithWordsDrawsThemAndNoBodyAtEverySize() throws {
    let empty = try snapshot(
      strength: block(
        last30: window("1 month", shades: [("chest", 4)]),
        month: window("March", shades: [], empty: "No strength workouts this month")))

    for size in [StrengthSize.small, .medium, .large] {
      let content = try XCTUnwrap(StrengthWidgetModel.content(empty, size: size, choice: .month))
      XCTAssertEqual(content.emptyText, "No strength workouts this month")
      XCTAssertEqual(content.sides, [])
      XCTAssertEqual(content.top.count, 0)
      XCTAssertEqual(content.label, "March")
    }
    let other = try XCTUnwrap(StrengthWidgetModel.content(empty, size: .small, choice: .last30))
    XCTAssertNil(other.emptyText)
    XCTAssertEqual(other.sides, [.front])
  }

  func testEmptyWordsAreNotAnEmptyWindow() throws {
    let blank = try snapshot(
      strength: block(
        last30: window("1 month", shades: [("chest", 4)], empty: ""),
        month: window("March", shades: [])))

    let content = try XCTUnwrap(StrengthWidgetModel.content(blank, size: .medium, choice: .last30))
    XCTAssertNil(content.emptyText)
    XCTAssertEqual(content.sides, [.front, .back])
  }

  func testTheBodyFollowsTheAthlete() throws {
    let female = try snapshot(
      strength: block(
        last30: window("1 month", shades: []), month: window("March", shades: []),
        body: "female"))
    XCTAssertEqual(
      StrengthWidgetModel.content(female, size: .small, choice: .last30)?.female, true)
    XCTAssertEqual(
      StrengthWidgetModel.content(try snapshot("demo"), size: .small, choice: .last30)?.female,
      false)
  }

  func testASnapshotWithoutTheBlockDrawsNothingOfItsOwn() throws {
    let older = try snapshot(strength: nil)
    XCTAssertNil(older.strength)
    XCTAssertNil(StrengthWidgetModel.content(older, size: .medium, choice: .last30))
    XCTAssertNil(StrengthWidgetModel.content(nil, size: .medium, choice: .last30))
  }

  func testShadesTakeTheRampLightestFirstAndUntrainedTakesNone() {
    XCTAssertEqual(StrengthWidgetModel.rampIndex(1, count: 5), 0)
    XCTAssertEqual(StrengthWidgetModel.rampIndex(5, count: 5), 4)
    XCTAssertEqual(StrengthWidgetModel.rampIndex(7, count: 5), 4)
    XCTAssertNil(StrengthWidgetModel.rampIndex(0, count: 5))
    XCTAssertNil(StrengthWidgetModel.rampIndex(nil, count: 5))
    XCTAssertNil(StrengthWidgetModel.rampIndex(3, count: 0))
  }

  func testEveryShadedSlugIsAPartTheBodyDraws() throws {
    let demo = try XCTUnwrap(try snapshot("demo").strength)
    let drawn = Set(
      [BodyOutline.Side.front, .back].flatMap { BodyOutline.parts(female: false, side: $0) }
        .map(\.slug))
    for muscle in demo.windows.last30.muscles + demo.windows.month.muscles {
      XCTAssert(drawn.contains(muscle.slug), "\(muscle.slug) is not drawn")
    }
  }
}
