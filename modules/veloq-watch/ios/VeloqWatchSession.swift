import Foundation
import WatchConnectivity

/// The one `WCSession` delegate of the process. The session has to be active
/// before launch finishes for a message that woke the app to be delivered, so
/// `VeloqWatchSessionSubscriber` activates it from `didFinishLaunching`.
///
/// A watch's request is a link request. The engine answers it through
/// `veloq_watch_answer`, version refusals included, so nothing here decides
/// what a version means. While the switch is off the answer is `off`.
public final class VeloqWatchSession: NSObject, WCSessionDelegate {
  public static let shared = VeloqWatchSession()

  private static let enabledKey = "veloq.watch.enabled"
  private let queue = DispatchQueue(label: "veloq.watch.answer", qos: .userInitiated)
  private let lock = NSLock()
  private var lastHello: String?
  /// What the application context holds now. WatchConnectivity keeps only the
  /// newest context, so each update is this dictionary with its keys replaced.
  private var context: [String: Any] = [:]

  /// Told with the request text and the reply text after a hello is answered.
  public var onHello: ((String, String) -> Void)?

  public var enabled: Bool {
    get { UserDefaults.standard.bool(forKey: Self.enabledKey) }
    set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
  }

  /// The newest protocol version the engine speaks, read from its own answer
  /// to a hello that spans every version.
  private lazy var version: Int = {
    guard let reply = Self.engine({ veloq_watch_hello(0, UInt32.max) }),
      let object = Self.object(reply),
      let result = object["result"] as? [String: Any],
      let protocolVersion = result["protocol"] as? Int
    else { return 0 }
    return protocolVersion
  }()

  public func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  public func state() -> [String: Any] {
    guard WCSession.isSupported() else { return ["supported": false] }
    let session = WCSession.default
    lock.lock()
    let hello = lastHello
    lock.unlock()
    return [
      "supported": true,
      "paired": session.isPaired,
      "installed": session.isWatchAppInstalled,
      "reachable": session.isReachable,
      "activated": session.activationState == .activated,
      "outstandingTransfers": session.outstandingUserInfoTransfers.count
        + session.outstandingFileTransfers.count,
      "lastHello": hello as Any,
    ]
  }

  /// Send the reply text of the nearby read as the application context. The
  /// context holds only the newest, which is what a list of nearby places is.
  public func updateNearby(_ reply: String) throws {
    guard enabled else { return }
    try send(["kind": "nearby", "pv": version, "reply": reply])
  }

  /// Send the reply text of one section read as the application context under
  /// the `guide` key, as the data the watch decodes. The newest section is the
  /// one the guide follows, and the context survives the watch being out of reach.
  public func sendSection(_ reply: String) throws {
    guard enabled else { return }
    try send(["kind": "section", "pv": version, "guide": Data(reply.utf8)])
  }

  private func send(_ entries: [String: Any]) throws {
    lock.lock()
    for (key, value) in entries { context[key] = value }
    let merged = context
    lock.unlock()
    try WCSession.default.updateApplicationContext(merged)
  }

  /// Transfer a file for a payload the context should not carry.
  public func sendFile(_ path: String, metadata: [String: Any]) {
    guard enabled else { return }
    var carried = metadata
    carried["kind"] = "file"
    carried["pv"] = version
    WCSession.default.transferFile(URL(fileURLWithPath: path), metadata: carried)
  }

  /// Ask the watch a link request while it is reachable, answering its reply
  /// text, or an error when it is not reachable or does not answer.
  public func sendMessage(_ request: String, completion: @escaping (String?, String?) -> Void) {
    let session = WCSession.default
    guard enabled else { return completion(nil, "off") }
    guard session.isReachable else { return completion(nil, "unreachable") }
    session.sendMessage(
      ["kind": "request", "pv": version, "request": request],
      replyHandler: { reply in completion(reply["reply"] as? String, nil) },
      errorHandler: { error in completion(nil, error.localizedDescription) }
    )
  }

  // MARK: WCSessionDelegate

  public func session(
    _ session: WCSession, activationDidCompleteWith state: WCSessionActivationState,
    error: Error?
  ) {}

  public func sessionDidBecomeInactive(_ session: WCSession) {}

  /// A second watch can be switched to, which leaves the session deactivated;
  /// activating it again picks the new one up.
  public func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  public func session(
    _ session: WCSession, didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    guard let request = message["request"] as? String else {
      return replyHandler(["reply": Self.error("malformed request")])
    }
    guard enabled else {
      return replyHandler(["reply": Self.off(request)])
    }
    queue.async {
      let reply = Self.engine({ request.withCString { veloq_watch_answer($0) } })
        ?? Self.error("engine unavailable")
      self.noteHello(request, reply)
      replyHandler(["reply": reply])
    }
  }

  public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    guard enabled, let request = message["request"] as? String else { return }
    queue.async {
      if let reply = Self.engine({ request.withCString { veloq_watch_answer($0) } }) {
        self.noteHello(request, reply)
      }
    }
  }

  private func noteHello(_ request: String, _ reply: String) {
    guard let parsed = Self.object(request), parsed["method"] as? String == "link.hello"
    else { return }
    lock.lock()
    lastHello = request
    lock.unlock()
    onHello?(request, reply)
  }

  /// Run an engine entry that answers an owned C string, copy it and free it.
  private static func engine(_ call: () -> UnsafeMutablePointer<CChar>?) -> String? {
    guard let pointer = call() else { return nil }
    defer { veloq_watch_free(pointer) }
    return String(cString: pointer)
  }

  private static func object(_ text: String) -> [String: Any]? {
    guard let data = text.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private static func error(_ reason: String) -> String {
    "{\"id\":null,\"error\":\"\(reason)\"}"
  }

  /// The reply while the switch is off, carrying the id the request had.
  private static func off(_ request: String) -> String {
    let id = object(request)?["id"]
    let body: [String: Any] = ["id": id ?? NSNull(), "error": "off"]
    let data = try? JSONSerialization.data(withJSONObject: body)
    return data.flatMap { String(data: $0, encoding: .utf8) } ?? error("off")
  }
}
