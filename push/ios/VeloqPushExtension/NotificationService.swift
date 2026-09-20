import UserNotifications

/// The iOS half of the native push path.
///
/// APNs invokes this for every visible push carrying `mutable-content`, which
/// `oauth-proxy/src/pushMessages.ts` sets, and gives it about thirty seconds
/// to rewrite the notification before the system posts what the server sent.
/// That is the one wake iOS grants deterministically, a force-quit app
/// included, which is why the enrichment lives here rather than in the silent
/// data push the JavaScript task runs on: iOS throttles those and delivers
/// none after a force-quit.
///
/// The whole of the work is the crate's: open the database in the App Group
/// container, fetch and index the ride, ask for the sentence. Every refusal
/// on the way ends the same, with the notification the server wrote delivered
/// unchanged. There is no error to show and nowhere to show it.
final class NotificationService: UNNotificationServiceExtension {
  private var deliver: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?
  private let once = NSLock()

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    deliver = contentHandler
    original = request.content

    guard let push = VeloqPushPayload(userInfo: request.content.userInfo) else {
      post(request.content)
      return
    }

    // Off the main thread, because every engine call blocks for its whole
    // duration and a fetch is a network round trip. The system calls
    // `serviceExtensionTimeWillExpire` on the main thread, and an extension
    // that blocked it would never hear the warning it exists to act on.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      self?.post(Self.enrich(request.content, with: push) ?? request.content)
    }
  }

  /// The last thirty seconds are up. Post the best content in hand, which is
  /// the server's: anything better would already have been posted.
  override func serviceExtensionTimeWillExpire() {
    post(original ?? UNMutableNotificationContent())
  }

  /// Answer APNs exactly once. Both the work and the expiry warning can
  /// arrive, and the system treats a second call as a programming error.
  private func post(_ content: UNNotificationContent) {
    once.lock()
    let handler = deliver
    deliver = nil
    once.unlock()
    handler?(content)
  }

  /// The ride as Veloq knows it, or nil for every case that leaves the
  /// server's line standing: no library in the container yet, a keychain that
  /// would not answer, an engine that would not open, notifications switched
  /// off, a fetch that brought nothing back, or a ride with nothing in it
  /// worth a sentence.
  private static func enrich(
    _ content: UNNotificationContent,
    with push: VeloqPushPayload
  ) -> UNNotificationContent? {
    guard
      let database = VeloqPaths.routeDatabase(),
      let credentials = VeloqCredentials.read(),
      VeloqPushEngine.prepare(databasePath: database, credentials: credentials),
      let sentence = VeloqPushEngine.sentence(activityId: push.activityId),
      let enriched = content.mutableCopy() as? UNMutableNotificationContent
    else { return nil }

    enriched.title = sentence.title
    enriched.body = sentence.body
    return enriched
  }
}
