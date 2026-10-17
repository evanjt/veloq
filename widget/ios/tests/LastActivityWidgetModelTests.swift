import XCTest

@testable import VeloqWidget

/// Scenario: the Last activity widget is laid out from an activity whose route carries the
/// activity's own name, and from one whose name differs from the route's.
///
/// Expected behaviour: a name is said once; a different route name stays above the hero. Each
/// fallback leaves out one more line, form first, and the comparison is in every one.
final class LastActivityWidgetModelTests: XCTestCase {
  private func snapshot(name: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: "demo", withExtension: "json", subdirectory: "fixtures"))
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    var latest = try XCTUnwrap(json["latest"] as? [String: Any])
    latest["name"] = name
    json["latest"] = latest
    return try JSONDecoder().decode(
      WidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
  }

  func testARouteNamedLikeTheActivityIsSaidOnce() throws {
    let content = try XCTUnwrap(
      LastActivityWidgetModel.content(snapshot(name: "Harbour Loop"), size: .medium))
    XCTAssertEqual(content.name, "Harbour Loop")
    XCTAssertNil(content.heroLabel)
  }

  func testARouteNamedOtherwiseStaysAboveTheHero() throws {
    let content = try XCTUnwrap(
      LastActivityWidgetModel.content(snapshot(name: "Morning ride"), size: .medium))
    XCTAssertEqual(content.name, "Morning ride")
    XCTAssertEqual(content.heroLabel, "Harbour Loop")
  }

  func testSmallLeavesOutTheNameAndKeepsTheRoute() throws {
    let content = try XCTUnwrap(
      LastActivityWidgetModel.content(snapshot(name: "Harbour Loop"), size: .small))
    XCTAssertNil(content.name)
    XCTAssertEqual(content.heroLabel, "Harbour Loop")
  }

  func testEachFallbackLeavesOutTheNextLineAndKeepsTheComparison() throws {
    let content = try XCTUnwrap(
      LastActivityWidgetModel.content(snapshot(name: "Morning ride"), size: .medium))
    let fallbacks = LastActivityWidgetModel.fallbacks(content)
    XCTAssertEqual(
      fallbacks.map {
        [$0.form != nil, $0.load != nil, $0.sectionPrs != nil, $0.heroLabel != nil, $0.name != nil]
      },
      [
        [true, true, true, true, true],
        [false, true, true, true, true],
        [false, false, true, true, true],
        [false, false, false, true, true],
        [false, false, false, false, true],
        [false, false, false, false, false],
      ])
    for fallback in fallbacks {
      XCTAssertEqual(fallback.hero, content.hero)
      XCTAssertEqual(fallback.detail, content.detail)
      XCTAssertEqual(fallback.dots.count, content.dots.count)
    }
  }

  /// The demo snapshot with the activity's form moved between the two zones given, worded.
  private func snapshot(beforeZone: String, afterZone: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: "demo", withExtension: "json", subdirectory: "fixtures"))
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    var impact = try XCTUnwrap(json["impact"] as? [String: Any])
    let words = ["greyZone": "Grey zone", "fresh": "Fresh"]
    impact["formBeforeZone"] = beforeZone
    impact["formBeforeZoneText"] = words[beforeZone]
    impact["formAfterZone"] = afterZone
    impact["formAfterZoneText"] = words[afterZone]
    json["impact"] = impact
    return try JSONDecoder().decode(
      WidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
  }

  func testAFormChangeAcrossZonesNamesBothZones() throws {
    let content = try XCTUnwrap(
      LastActivityWidgetModel.content(
        snapshot(beforeZone: "greyZone", afterZone: "fresh"), size: .medium))
    let form = try XCTUnwrap(content.form)
    XCTAssertEqual(form.beforeZoneText, "Grey zone")
    XCTAssertEqual(form.afterZoneText, "Fresh")
  }

  func testAFormChangeInsideOneZoneNamesItOnce() throws {
    let content = try XCTUnwrap(
      LastActivityWidgetModel.content(
        snapshot(beforeZone: "fresh", afterZone: "fresh"), size: .medium))
    let form = try XCTUnwrap(content.form)
    XCTAssertNil(form.beforeZoneText)
    XCTAssertEqual(form.afterZoneText, "Fresh")
  }

  func testWithNoComparisonTheNameIsNeverLeftOut() throws {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: "demo", withExtension: "json", subdirectory: "fixtures"))
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    var latest = try XCTUnwrap(json["latest"] as? [String: Any])
    latest["headline"] = NSNull()
    json["latest"] = latest
    let snapshot = try JSONDecoder().decode(
      WidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
    let content = try XCTUnwrap(LastActivityWidgetModel.content(snapshot, size: .medium))
    let last = try XCTUnwrap(LastActivityWidgetModel.fallbacks(content).last)
    XCTAssertEqual(last.name, "Harbour Loop")
    XCTAssertNotNil(last.figures)
  }

  func testThisActivityCarriesTheReticleAndTheRecordItsGoldDotCombinedByShape() {
    XCTAssertEqual(
      LastActivityDot(current: false, record: false).mark,
      LastActivityDotMark(fill: .earlier, full: false, reticle: false))
    XCTAssertEqual(
      LastActivityDot(current: false, record: true).mark,
      LastActivityDotMark(fill: .record, full: true, reticle: false))
    XCTAssertEqual(
      LastActivityDot(current: true, record: false).mark,
      LastActivityDotMark(fill: .earlier, full: true, reticle: true))
    XCTAssertEqual(
      LastActivityDot(current: true, record: true).mark,
      LastActivityDotMark(fill: .record, full: true, reticle: true))
  }
}
