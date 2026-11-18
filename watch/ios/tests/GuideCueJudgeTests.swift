import XCTest
@testable import VeloqWatchPure

final class GuideCueJudgeTests: XCTestCase {
    /// A line running due north from the origin, 1 km, a vertex every 100 m.
    private let line: [GuideCoordinate] = (0...10).map {
        GuideCoordinate(latitude: Double($0) * 100 / 111_320, longitude: 0, elevation: 10)
    }

    private func fix(northMetres: Double, eastMetres: Double = 0, time: TimeInterval) -> GuideFix {
        GuideFix(
            coordinate: GuideCoordinate(latitude: northMetres / 111_320, longitude: eastMetres / 111_320),
            time: time
        )
    }

    private func cues(_ fixes: [GuideFix]) -> [GuideCue] {
        var judge = GuideCueJudge(line: line)
        return fixes.flatMap { judge.judge($0) }
    }

    func testStartThenEndCueFromARideAlongTheLine() {
        let fixes = stride(from: -400.0, through: 1_100.0, by: 10).enumerated().map {
            fix(northMetres: $0.element, time: Double($0.offset))
        }
        XCTAssertEqual(cues(fixes), [.start, .end])
    }

    func testStartCueFiresAtTwoHundredMetres() {
        var judge = GuideCueJudge(line: line)
        XCTAssertEqual(judge.judge(fix(northMetres: -250, time: 0)), [])
        XCTAssertEqual(judge.judge(fix(northMetres: -199, time: 1)), [.start])
        XCTAssertEqual(judge.judge(fix(northMetres: -150, time: 2)), [])
    }

    func testNoCueForASequenceThatNeverComesWithinTwoHundredMetres() {
        let fixes = (0..<60).map { fix(northMetres: -300, eastMetres: Double($0) * 20, time: Double($0)) }
        XCTAssertEqual(cues(fixes), [])
    }

    func testOffRouteCueAfterTenSecondsPastFiftyMetres() {
        var judge = GuideCueJudge(line: line)
        _ = judge.judge(fix(northMetres: 300, time: 0))
        XCTAssertEqual(judge.judge(fix(northMetres: 310, eastMetres: 60, time: 1)), [])
        XCTAssertEqual(judge.judge(fix(northMetres: 320, eastMetres: 60, time: 10)), [])
        XCTAssertEqual(judge.judge(fix(northMetres: 330, eastMetres: 60, time: 11)), [.offRoute])
        XCTAssertEqual(judge.judge(fix(northMetres: 340, eastMetres: 60, time: 30)), [])
    }

    func testReturningToTheLineRestartsTheOffRouteClock() {
        var judge = GuideCueJudge(line: line)
        _ = judge.judge(fix(northMetres: 300, time: 0))
        _ = judge.judge(fix(northMetres: 310, eastMetres: 60, time: 1))
        _ = judge.judge(fix(northMetres: 320, time: 8))
        XCTAssertEqual(judge.judge(fix(northMetres: 330, eastMetres: 60, time: 9)), [])
        XCTAssertEqual(judge.judge(fix(northMetres: 340, eastMetres: 60, time: 18)), [])
        XCTAssertEqual(judge.judge(fix(northMetres: 350, eastMetres: 60, time: 19)), [.offRoute])
    }

    func testTheApproachOffTheLineIsNotOffRoute() {
        let fixes = (0..<30).map { fix(northMetres: -180, eastMetres: 120, time: Double($0)) }
        XCTAssertEqual(cues(fixes), [])
    }

    func testFinishesFiveHundredMetresPastTheEnd() {
        var judge = GuideCueJudge(line: line)
        _ = judge.judge(fix(northMetres: 1_000, time: 0))
        XCTAssertFalse(judge.isFinished)
        _ = judge.judge(fix(northMetres: 1_400, time: 1))
        XCTAssertFalse(judge.isFinished)
        _ = judge.judge(fix(northMetres: 1_501, time: 2))
        XCTAssertTrue(judge.isFinished)
        XCTAssertEqual(judge.judge(fix(northMetres: 0, time: 3)), [])
    }

    func testPayloadDecodesTheLatitudeLongitudeElevationKeys() throws {
        let json = #"{"name":"Hill","line":[{"latitude":1.5,"longitude":2.5,"elevation":30},{"latitude":1.6,"longitude":2.6}]}"#
        let payload = try XCTUnwrap(GuidePayload.decode(Data(json.utf8)))
        XCTAssertEqual(payload.name, "Hill")
        XCTAssertEqual(payload.coordinates.first, GuideCoordinate(latitude: 1.5, longitude: 2.5, elevation: 30))
        XCTAssertNil(payload.coordinates.last?.elevation)
    }

    func testPayloadWithoutALineIsRejected() {
        XCTAssertNil(GuidePayload.decode(Data(#"{"name":"x","line":[{"latitude":1,"longitude":2}]}"#.utf8)))
        XCTAssertNil(GuidePayload.decode(Data("nope".utf8)))
    }
}
