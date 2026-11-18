import SwiftUI

/// What the last application context carried, and a button that asks the phone
/// to send it again.
struct WatchStatusView: View {
    @EnvironmentObject private var session: WatchSession
    @EnvironmentObject private var guide: GuideLocation

    var body: some View {
        List {
            GuideView()
            if let payload = session.guidePayload, guide.payload != payload {
                Button("Guide: \(payload.name)") { guide.start(payload) }
            }
            if session.rows.isEmpty {
                Text("Nothing from the phone yet")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(session.rows) { row in
                    VStack(alignment: .leading) {
                        Text(row.key)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text(row.value)
                    }
                }
            }
            Button("Ask the phone") { session.askPhone() }
                .disabled(!session.phoneReachable)
        }
        .navigationTitle("Veloq")
    }
}
