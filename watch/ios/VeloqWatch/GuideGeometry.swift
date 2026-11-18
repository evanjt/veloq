import Foundation

/// A point on a section's line: degrees, and metres above sea level when the
/// payload carries them.
struct GuideCoordinate: Equatable {
    let latitude: Double
    let longitude: Double
    let elevation: Double?

    init(latitude: Double, longitude: Double, elevation: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.elevation = elevation
    }
}

/// Distances on the ground, in metres, over the few kilometres a guide spans.
/// A local equirectangular projection is within a metre of the great-circle
/// distance there, which is inside a GPS fix's own error.
enum GuideGeometry {
    private static let metresPerDegree = 111_320.0

    /// Metres from `a` to `b`.
    static func distance(_ a: GuideCoordinate, _ b: GuideCoordinate) -> Double {
        let (x, y) = offset(from: a, to: b)
        return (x * x + y * y).squareRoot()
    }

    /// Metres from `point` to the nearest point of the polyline `line`. A line
    /// of one point is that point, and an empty line is infinitely far.
    static func distance(from point: GuideCoordinate, toLine line: [GuideCoordinate]) -> Double {
        guard let first = line.first else { return .infinity }
        if line.count == 1 { return distance(point, first) }
        var best = Double.infinity
        for index in 1..<line.count {
            best = min(best, distance(from: point, toSegment: line[index - 1], line[index]))
        }
        return best
    }

    private static func distance(
        from point: GuideCoordinate, toSegment a: GuideCoordinate, _ b: GuideCoordinate
    ) -> Double {
        let reference = point
        let (ax, ay) = offset(from: reference, to: a)
        let (bx, by) = offset(from: reference, to: b)
        let dx = bx - ax
        let dy = by - ay
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return (ax * ax + ay * ay).squareRoot() }
        let t = max(0, min(1, -(ax * dx + ay * dy) / lengthSquared))
        let cx = ax + t * dx
        let cy = ay + t * dy
        return (cx * cx + cy * cy).squareRoot()
    }

    /// East and north metres from `origin` to `target`.
    private static func offset(from origin: GuideCoordinate, to target: GuideCoordinate) -> (Double, Double) {
        let meanLatitude = (origin.latitude + target.latitude) / 2 * .pi / 180
        let x = (target.longitude - origin.longitude) * metresPerDegree * cos(meanLatitude)
        let y = (target.latitude - origin.latitude) * metresPerDegree
        return (x, y)
    }
}
