import XCTest

@testable import VeloqWidget

/// Scenario: the age line tells the athlete how old the widget's numbers are, and it is read at a
/// glance on a home screen.
///
/// Expected behaviour: under a minute it says now, then whole minutes ago under an hour and whole
/// hours ago after, never a count of seconds and never zero minutes; the timeline carries an
/// entry at every moment that wording changes, so the line moves on without a reload.
final class SnapshotAgeTests: XCTestCase {
  private let written: Double = 1_791_300_000
  private let english = Locale(identifier: "en_AU")

  private func after(_ seconds: Double) -> Date {
    Date(timeIntervalSince1970: written + seconds)
  }

  private func snapshot(generatedAt: Double) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: "no-wellness", withExtension: "json", subdirectory: "fixtures"))
    var json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    json["generatedAt"] = generatedAt
    var display = try XCTUnwrap(json["display"] as? [String: Any])
    display.removeValue(forKey: "demoLabel")
    display.removeValue(forKey: "dataAsOfLabel")
    json["display"] = display
    return try JSONDecoder().decode(
      WidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: json))
  }

  func testUnderAMinuteTheAgeReadsAsNowRatherThanSecondsOrZeroMinutes() {
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(0)), .now)
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(59.9)), .now)
    XCTAssertEqual(SnapshotAge.text(.now, locale: english), "now")
  }

  func testTheAgeCountsWholeMinutesFromAMinuteToAnHour() {
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(60)), .minutes(1))
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(119)), .minutes(1))
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(3599)), .minutes(59))
    let line = SnapshotAge.text(.minutes(5), locale: english)
    XCTAssertTrue(line.hasPrefix("5 min"), line)
    XCTAssertTrue(line.hasSuffix("ago"), line)
    XCTAssertFalse(line.contains("sec"), line)
  }

  func testTheAgeCountsWholeHoursFromAnHour() {
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(3600)), .hours(1))
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(23 * 3600 + 3599)), .hours(23))
    let line = SnapshotAge.text(.hours(2), locale: english)
    XCTAssertTrue(line.hasPrefix("2 hr"), line)
    XCTAssertTrue(line.hasSuffix("ago"), line)
  }

  func testASnapshotFromTheFutureReadsAsJustWritten() {
    XCTAssertEqual(SnapshotAge.span(since: written, now: after(-180)), .now)
  }

  func testTheTimelineChangesTheLineEachMinuteOfTheFirstHourThenEachHour() throws {
    let snap = try snapshot(generatedAt: written)

    let changes = SnapshotAge.changes(snap, after: after(0), before: after(3 * 3600 + 1))

    let expected = (1..<60).map { after(Double($0) * 60) } + [after(3600), after(7200), after(10800)]
    XCTAssertEqual(changes, expected)
  }

  func testTheTimelineChangesTheLineWhenItTurnsStale() throws {
    let snap = try snapshot(generatedAt: written)

    let changes = SnapshotAge.changes(snap, after: after(22 * 3600 + 30), before: after(26 * 3600))

    XCTAssertEqual(
      changes, [after(23 * 3600), after(24 * 3600), after(SnapshotAge.staleAfter + 1)])
  }

  func testASampleLibraryHasNoAgeToMoveOn() throws {
    XCTAssertEqual(SnapshotAge.changes(nil, after: after(0), before: after(3600)), [])
  }

  func testTheSummaryTimelineCarriesAnEntryForEachChange() throws {
    let snap = try snapshot(generatedAt: Date().timeIntervalSince1970)

    let timeline = summaryTimeline(VeloqEntry(date: Date(), snapshot: snap))

    XCTAssertGreaterThan(timeline.entries.count, 59)
    XCTAssertEqual(timeline.entries.map(\.date), timeline.entries.map(\.date).sorted())
  }
}
