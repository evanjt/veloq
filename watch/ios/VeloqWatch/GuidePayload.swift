import Foundation

/// The section or route the phone sends for a guide: a name and the line as
/// points, each with the latitude, longitude and elevation keys the engine's
/// guide read writes. Everything else the engine sends is ignored here.
struct GuidePayload: Decodable, Equatable {
    struct Point: Decodable, Equatable {
        let latitude: Double
        let longitude: Double
        let elevation: Double?
    }

    let name: String
    let line: [Point]

    var coordinates: [GuideCoordinate] {
        line.map { GuideCoordinate(latitude: $0.latitude, longitude: $0.longitude, elevation: $0.elevation) }
    }

    /// The link's answer envelope, which carries the payload under `result`.
    private struct Reply: Decodable {
        let result: GuidePayload
    }

    /// The payload in `data`, bare or inside the link's answer envelope, or nil when it is not one or its line has fewer
    /// than two points, which is no line to guide along.
    static func decode(_ data: Data) -> GuidePayload? {
        let payload = (try? JSONDecoder().decode(GuidePayload.self, from: data))
            ?? (try? JSONDecoder().decode(Reply.self, from: data))?.result
        guard let payload, payload.line.count >= 2 else { return nil }
        return payload
    }
}
