import SwiftUI

/// The guide screen: the loaded section's name, the last cue, an End button, and
/// a tap that opens the section on a map.
struct GuideView: View {
    @EnvironmentObject private var guide: GuideLocation

    var body: some View {
        if let payload = guide.payload {
            NavigationLink {
                GuideMapView(payload: payload, position: guide.position)
            } label: {
                VStack(alignment: .leading) {
                    Text(payload.name).font(.headline)
                    Text(status).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Button("End guide", role: .destructive) { guide.stop() }
        }
    }

    private var status: String {
        if !guide.notificationsAuthorised {
            return String(localized: "Allow notifications in the iPhone app")
        }
        switch guide.lastCue {
        case .start: return String(localized: "Section started")
        case .end: return String(localized: "Section ended")
        case .offRoute: return String(localized: "Off the line")
        case nil: return String(localized: "Guiding")
        }
    }
}
