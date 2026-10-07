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
/// unchanged. Every exit that has a database path also records a failed run
/// with its reason, where the Developer Dashboard lists the runs. With no
/// library in the container there is nowhere to write, so no row then means
/// the extension was not invoked or there was no library.
final class NotificationService: UNNotificationServiceExtension {
  private var deliver: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?
  private var activityId: String?
  private let once = NSLock()

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    deliver = contentHandler
    original = request.content

    guard let push = VeloqPushPayload(userInfo: request.content.userInfo) else {
      post(request.content)
      if let database = VeloqPaths.routeDatabase() {
        let userInfo = request.content.userInfo
        let body = userInfo["body"] as? [String: Any]
        let reason = VeloqPushEngine.payloadReason(
          topLevelKeys: userInfo.keys.compactMap { $0 as? String },
          bodyKeys: body.map { Array($0.keys) }
        )
        VeloqPushEngine.recordRefusal(databasePath: database, activityId: nil, reason: reason)
      }
      return
    }

    activityId = push.activityId

    // Off the main thread, because every engine call blocks for its whole
    // duration and a fetch is a network round trip. The system calls
    // `serviceExtensionTimeWillExpire` on the main thread, and an extension
    // that blocked it would never hear the warning it exists to act on.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      self?.post(Self.enrich(request.content, with: push) ?? request.content)
    }
  }

  /// The last thirty seconds are up. Post the best content in hand, which is
  /// the server's: anything better would already have been posted. The run is
  /// recorded after, best effort, since the budget is spent.
  override func serviceExtensionTimeWillExpire() {
    post(original ?? UNMutableNotificationContent())
    if let database = VeloqPaths.routeDatabase() {
      VeloqPushEngine.recordRefusal(
        databasePath: database, activityId: activityId, reason: "time ran out")
    }
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
  /// off or an athlete who differs. A ride with nothing in it worth
  /// a sentence is posted as the stored title over the ride's name. Each
  /// refusal that has a database path is recorded with its reason.
  private static func enrich(
    _ content: UNNotificationContent,
    with push: VeloqPushPayload
  ) -> UNNotificationContent? {
    guard let database = VeloqPaths.routeDatabase() else { return nil }
    func refuse(_ reason: String) -> UNNotificationContent? {
      VeloqPushEngine.recordRefusal(
        databasePath: database, activityId: push.activityId, reason: reason)
      return nil
    }

    guard let credentials = VeloqCredentials.read() else {
      return refuse("the keychain answered nothing")
    }
    let prepared = VeloqPushEngine.prepare(databasePath: database, credentials: credentials)
    guard prepared.ready else {
      return refuse(prepared.refusal ?? "prepare refused")
    }
    // A nil answer is the engine's own: notifications off or another athlete,
    // which it records itself as a run.
    guard let answer = VeloqPushEngine.sentence(activityId: push.activityId, athleteId: push.athleteId)
    else { return nil }
    guard
      let sentence = VeloqSentence(json: answer),
      let enriched = content.mutableCopy() as? UNMutableNotificationContent
    else { return refuse("the answer would not parse") }

    enriched.title = sentence.title
    enriched.body = sentence.body
    return enriched
  }
}
