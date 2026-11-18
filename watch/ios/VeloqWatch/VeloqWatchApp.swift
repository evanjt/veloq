import SwiftUI

/// The watch app. It shows what the phone last sent and asks the phone for more;
/// it computes nothing itself.
@main
struct VeloqWatchApp: App {
    @StateObject private var session = WatchSession()
    @StateObject private var guide = GuideLocation()

    var body: some Scene {
        WindowGroup {
            NavigationStack { WatchStatusView() }
                .environmentObject(session)
                .environmentObject(guide)
        }
    }
}
