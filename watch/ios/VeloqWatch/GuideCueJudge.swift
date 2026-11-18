import Foundation

/// One position fix: where, and when in seconds.
struct GuideFix: Equatable {
    let coordinate: GuideCoordinate
    let time: TimeInterval
}

/// What the guide tells the athlete.
enum GuideCue: Equatable {
    case start
    case end
    case offRoute
}

/// Decides, fix by fix, which cues a loaded line has earned. It holds no
/// location manager and no clock, so a sequence of fixes decides everything it
/// returns.
///
/// - `start`: once, at the first fix within `startWarningDistance` of the
///   line's first point.
/// - `end`: once, at the first fix within `endReachDistance` of the line's last
///   point.
/// - `offRoute`: once per excursion, when a fix has been more than
///   `offRouteDistance` from the line for `offRouteSeconds`. It judges only
///   after the athlete has been within `offRouteDistance` of the line once,
///   because the approach to the start is off the line by design.
/// - `isFinished`: after the end cue, a fix `finishDistance` past the end.
struct GuideCueJudge {
    static let startWarningDistance = 200.0
    static let endReachDistance = 25.0
    static let offRouteDistance = 50.0
    static let offRouteSeconds = 10.0
    static let finishDistance = 500.0

    let line: [GuideCoordinate]

    private(set) var isFinished = false
    private var startCued = false
    private var endCued = false
    private var onLineSeen = false
    private var offLineSince: TimeInterval?
    private var offRouteCued = false

    init(line: [GuideCoordinate]) {
        self.line = line
    }

    /// The cues this fix raises, in order.
    mutating func judge(_ fix: GuideFix) -> [GuideCue] {
        guard let first = line.first, let last = line.last, !isFinished else { return [] }
        var cues: [GuideCue] = []
        let position = fix.coordinate

        if !startCued, GuideGeometry.distance(position, first) <= Self.startWarningDistance {
            startCued = true
            cues.append(.start)
        }

        let fromEnd = GuideGeometry.distance(position, last)
        if !endCued, fromEnd <= Self.endReachDistance {
            endCued = true
            cues.append(.end)
        }
        if endCued, fromEnd >= Self.finishDistance {
            isFinished = true
            return cues
        }

        if GuideGeometry.distance(from: position, toLine: line) <= Self.offRouteDistance {
            onLineSeen = true
            offLineSince = nil
            offRouteCued = false
        } else if onLineSeen, !endCued {
            let since = offLineSince ?? fix.time
            offLineSince = since
            if !offRouteCued, fix.time - since >= Self.offRouteSeconds {
                offRouteCued = true
                cues.append(.offRoute)
            }
        }
        return cues
    }
}
