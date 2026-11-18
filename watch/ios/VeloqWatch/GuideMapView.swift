import MapKit
import SwiftUI

/// The loaded section's line on a map, with the athlete's position.
struct GuideMapView: View {
    let payload: GuidePayload
    let position: GuideCoordinate?

    var body: some View {
        Map {
            MapPolyline(coordinates: payload.coordinates.map(Self.location))
                .stroke(.blue, lineWidth: 4)
            if let position {
                Annotation("", coordinate: Self.location(position)) {
                    Circle().fill(.orange).frame(width: 12, height: 12)
                }
            }
        }
        .navigationTitle(payload.name)
    }

    private static func location(_ coordinate: GuideCoordinate) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
}
