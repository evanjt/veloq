import XCTest

@testable import VeloqWidget

/// Scenario: a strength session pushes a state that carries none of the recording fields.
///
/// Expected behaviour: it decodes, names its phase, exercise and next set, and reports its rest
/// end only while resting on a rest that has a length; a recording's state still decodes as one.
final class StrengthLiveActivityStateTests: XCTestCase {
  private func decode(_ json: String) throws -> VeloqRecordingAttributes.ContentState {
    try JSONDecoder().decode(
      VeloqRecordingAttributes.ContentState.self, from: Data(json.utf8))
  }

  func testARestStateDecodesWithItsEndAndNextSet() throws {
    let state = try decode(
      """
      {"kind":"strength","phase":"rest","exercise":"Row","nextSet":"Row 8 x 40 kg",\
      "restEndsAt":1700000090000,"staleAt":1700000390000}
      """)
    XCTAssertTrue(state.isStrength)
    XCTAssertEqual(state.exercise, "Row")
    XCTAssertEqual(state.nextSet, "Row 8 x 40 kg")
    XCTAssertEqual(state.restEnd, Date(timeIntervalSince1970: 1_700_000_090))
  }

  func testASetStateHasNoRestEnd() throws {
    let state = try decode(
      """
      {"kind":"strength","phase":"set","exercise":"Row","nextSet":null,\
      "restEndsAt":null,"staleAt":1700000390000}
      """)
    XCTAssertTrue(state.isStrength)
    XCTAssertNil(state.restEnd)
    XCTAssertNil(state.nextSet)
  }

  func testARecordingStateIsNotStrength() throws {
    let state = try decode(
      """
      {"status":"recording","timerFrom":1700000000000,"distanceLabel":"1 km",\
      "speedLabel":"20 km/h","staleAt":1700000390000}
      """)
    XCTAssertFalse(state.isStrength)
    XCTAssertNil(state.restEnd)
    XCTAssertEqual(state.distanceLabel, "1 km")
  }
}
