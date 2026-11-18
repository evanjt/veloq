import Foundation
import WatchConnectivity

/// The watch's end of the link to the phone. The phone pushes an application
/// context, which WatchConnectivity keeps until the next one replaces it, so the
/// watch shows the last state even when the phone is out of reach.
final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
    /// The key a request to the phone carries.
    static let requestKey = "request"
    /// The value that asks the phone to send its context again.
    static let refreshRequest = "refresh"

    /// What the last application context carried, in the order a reader scans it.
    @Published private(set) var rows: [WatchContextRow] = []
    /// Whether the phone can be reached for a request right now.
    @Published private(set) var phoneReachable = false

    /// The key a context carries a guide payload under, as JSON data.
    static let guideKey = "guide"

    /// The section the phone last sent for the guide, if it decoded.
    @Published private(set) var guidePayload: GuidePayload?

    private let session: WCSession?

    override init() {
        session = WCSession.isSupported() ? WCSession.default : nil
        super.init()
        session?.delegate = self
        session?.activate()
    }

    /// Ask the phone to send its context again. A phone out of reach is a no-op:
    /// the next context it sends arrives on its own.
    func askPhone() {
        guard let session, session.isReachable else { return }
        session.sendMessage([Self.requestKey: Self.refreshRequest], replyHandler: nil, errorHandler: nil)
    }

    private func adopt(context: [String: Any]) {
        let guide = (context[Self.guideKey] as? Data).flatMap(GuidePayload.decode)
        let rows = WatchContextRow.rows(from: context.filter { $0.key != Self.guideKey })
        DispatchQueue.main.async {
            self.rows = rows
            if let guide { self.guidePayload = guide }
        }
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        adopt(context: session.receivedApplicationContext)
        DispatchQueue.main.async { self.phoneReachable = session.isReachable }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.phoneReachable = session.isReachable }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        adopt(context: applicationContext)
    }
}

/// One entry of the application context, as a label and the text shown for it.
struct WatchContextRow: Identifiable, Equatable {
    let key: String
    let value: String

    var id: String { key }

    /// The entries of a context sorted by key, so the list does not reorder
    /// between two contexts that carry the same keys.
    static func rows(from context: [String: Any]) -> [WatchContextRow] {
        context
            .map { WatchContextRow(key: $0.key, value: String(describing: $0.value)) }
            .sorted { $0.key < $1.key }
    }
}
