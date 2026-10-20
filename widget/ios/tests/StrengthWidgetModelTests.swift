import XCTest

@testable import VeloqWidget

/// Scenario: the Strength widget is placed at each size over a snapshot the engine composed, one
/// whose window holds no sessions, one written while the calendar month was still offered, and
/// one written before the strength block.
///
/// Expected behaviour: small draws the front, medium the front and back, large both and the
/// window's top rows; every placement draws the last 30 days; a window with words draws them and
/// no body; a snapshot with no block draws nothing of its own.
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

  private func block(last30: [String: Any], body: String = "male") -> [String: Any] {
    [
      "body": body, "url": "veloq://insights?tab=strength&period=1m",
      "windows": ["last30": last30],
    ]
  }

  func testEachSizeDrawsItsSidesAndOnlyLargeListsTheTopMuscles() throws {
    let demo = try snapshot("demo")
    let small = try XCTUnwrap(StrengthWidgetModel.content(demo, size: .small))
    let medium = try XCTUnwrap(StrengthWidgetModel.content(demo, size: .medium))
    let large = try XCTUnwrap(StrengthWidgetModel.content(demo, size: .large))

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

  func testASnapshotThatStillCarriesTheCalendarMonthDrawsTheLast30Days() throws {
    let older = try snapshot(
      strength: [
        "body": "male", "url": "veloq://insights?tab=strength&period=1m",
        "windows": [
          "month": window("March", shades: [("calves", 3)]),
          "last30": window("1 month", shades: [("chest", 5), ("biceps", 2)]),
        ],
      ])

    let drawn = try XCTUnwrap(StrengthWidgetModel.content(older, size: .large))

    XCTAssertEqual(drawn.label, "1 month")
    XCTAssertEqual(drawn.shades, ["chest": 5, "biceps": 2])
    XCTAssertEqual(drawn.top.map(\.slug), ["chest", "biceps"])
  }

  func testLargeRowsCarryHowOftenAWeekAsTheEngineWordsItAndAnOlderSnapshotNone() throws {
    let demo = try snapshot("demo")
    let large = try XCTUnwrap(StrengthWidgetModel.content(demo, size: .large))
    XCTAssertEqual(
      large.top.map(\.frequencyText), demo.strength?.windows.last30.top.map(\.frequencyText))
    for row in large.top {
      XCTAssertEqual(row.frequencyText?.hasSuffix("×/wk"), true, row.slug)
    }

    let older = try snapshot(
      strength: block(last30: window("1 month", shades: [("chest", 5)])))
    let drawn = try XCTUnwrap(StrengthWidgetModel.content(older, size: .large))
    XCTAssertEqual(drawn.top.map(\.slug), ["chest"])
    XCTAssertNil(drawn.top.first?.frequencyText)
  }

  func testAWindowWithWordsDrawsThemAndNoBodyAtEverySize() throws {
    let empty = try snapshot(
      strength: block(
        last30: window(
          "1 month", shades: [], empty: "No strength workouts in the last 1 month")))

    for size in [StrengthSize.small, .medium, .large] {
      let content = try XCTUnwrap(StrengthWidgetModel.content(empty, size: size))
      XCTAssertEqual(content.emptyText, "No strength workouts in the last 1 month")
      XCTAssertEqual(content.sides, [])
      XCTAssertEqual(content.top.count, 0)
      XCTAssertEqual(content.label, "1 month")
    }
  }

  func testEmptyWordsAreNotAnEmptyWindow() throws {
    let blank = try snapshot(
      strength: block(last30: window("1 month", shades: [("chest", 4)], empty: "")))

    let content = try XCTUnwrap(StrengthWidgetModel.content(blank, size: .medium))
    XCTAssertNil(content.emptyText)
    XCTAssertEqual(content.sides, [.front, .back])
  }

  func testTheBodyFollowsTheAthlete() throws {
    let female = try snapshot(
      strength: block(last30: window("1 month", shades: []), body: "female"))
    XCTAssertEqual(StrengthWidgetModel.content(female, size: .small)?.female, true)
    XCTAssertEqual(StrengthWidgetModel.content(try snapshot("demo"), size: .small)?.female, false)
  }

  func testASnapshotWithoutTheBlockDrawsNothingOfItsOwn() throws {
    let older = try snapshot(strength: nil)
    XCTAssertNil(older.strength)
    XCTAssertNil(StrengthWidgetModel.content(older, size: .medium))
    XCTAssertNil(StrengthWidgetModel.content(nil, size: .medium))
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
    for muscle in demo.windows.last30.muscles {
      XCTAssert(drawn.contains(muscle.slug), "\(muscle.slug) is not drawn")
    }
  }
}
