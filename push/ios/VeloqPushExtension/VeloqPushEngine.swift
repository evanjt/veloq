import Foundation

/// The engine, as the extension reaches it: a few C symbols out of the Rust
/// static library, with the ownership rules folded in so no call site repeats
/// them.
///
/// Nothing here decides anything. Which credential to use, whether there is a
/// sentence worth posting and what it says are all the crate's, tested on a
/// host by `modules/veloqrs/rust/veloqrs/tests/push_service_extension.rs`. An
/// extension cannot be tested off a device, so nothing that can be decided
/// elsewhere is decided here.
enum VeloqPushEngine {
  /// Open the database at `path` and set the credential, and say whether a
  /// fetch can be attempted. False is the phone rebooted and not unlocked, a
  /// signed-out install, or a database that would not open: in all three the
  /// caller posts what it was given. The refusal's sentence is the second
  /// element, for the caller to record.
  static func prepare(
    databasePath: String, credentials: VeloqCredentials
  ) -> (ready: Bool, refusal: String?) {
    var refusal: UnsafeMutablePointer<CChar>?
    let ready = withOptional(credentials.accessToken) { token in
      withOptional(credentials.apiKey) { key in
        credentials.athleteId.withCString { athlete in
          databasePath.withCString { path in
            veloq_push_prepare(path, token, key, athlete, &refusal)
          }
        }
      }
    }
    return (ready, take(refusal))
  }

  /// Hand the crate the Garmin key for the push about to run, nil when the
  /// athlete has none. The crate keeps it in process memory and nowhere else.
  static func holdGarminKey(_ key: String?) {
    withOptional(key) { veloq_push_hold_garmin_key($0) }
  }

  /// Keep a push that ended before the engine answered as a failed run, where
  /// the Developer Dashboard reads it. Best effort: nothing waits on it.
  static func recordRefusal(databasePath: String, activityId: String?, reason: String) {
    databasePath.withCString { path in
      (activityId ?? "").withCString { id in
        reason.withCString { veloq_push_record_refusal(path, id, $0) }
      }
    }
  }

  /// The reason for a payload that was not recognised, built by the crate from
  /// key names alone. The values never cross.
  static func payloadReason(topLevelKeys: [String], bodyKeys: [String]?) -> String {
    let top = topLevelKeys.joined(separator: "\n")
    let reason = top.withCString { topKeys in
      withOptional(bodyKeys?.joined(separator: "\n")) { bodyPointer in
        take(veloq_push_payload_reason(topKeys, bodyPointer))
      }
    }
    return reason ?? "payload not recognised"
  }

  /// One activity push, end to end: the gate, the detail body, the track and
  /// its index, then the title and body to post as JSON, which `VeloqSentence`
  /// reads. The skip marker when notifications are off or the athlete differs,
  /// and nil when the engine could not answer at all. A ride with nothing worth
  /// a sentence, or a step that failed, is answered with the plain entry.
  ///
  /// One call rather than three, and the same entry the Android worker makes:
  /// the gate is read before anything is fetched, the detail body writes the
  /// metrics row the ladder needs to date a lap, and it carries the ride's
  /// name, which the push itself does not.
  static func sentence(activityId: String, athleteId: String) -> String? {
    activityId.withCString { id in
      athleteId.withCString { athlete in
        take(veloq_push_activity(id, athlete))
      }
    }
  }

  /// The widget snapshot as the widget file holds it, composed from the context
  /// the app last stored and the device clock. Nil when the engine is not open
  /// or the app has never stored a context.
  static func widgetSnapshot() -> String? {
    take(veloq_push_widget_snapshot())
  }

  /// A string the crate handed out, copied and given straight back. Nothing
  /// else may free it.
  private static func take(_ answer: UnsafeMutablePointer<CChar>?) -> String? {
    guard let answer else { return nil }
    defer { veloq_push_string_free(answer) }
    return String(cString: answer)
  }

  /// `withCString` for a value that may be absent. Swift bridges a `String`
  /// to a pointer for the length of a call and an `Optional<String>` not at
  /// all, and the crate reads null as "the keychain answered nothing".
  private static func withOptional<R>(_ value: String?, _ body: (UnsafePointer<CChar>?) -> R) -> R {
    guard let value else { return body(nil) }
    return value.withCString { body($0) }
  }
}

/// What the crate answered, as the two lines a lock screen shows.
struct VeloqSentence {
  let title: String
  let body: String

  /// The crate writes the JSON by hand, two keys and nothing nested. An
  /// answer that will not parse, or has no title, is no answer: the caller
  /// posts its own fallback rather than an empty line. An empty body is an
  /// answer, the stored title for a run that failed before it learned the
  /// ride's name, which is what Android posts for the same run.
  init?(json: String) {
    guard
      let data = json.data(using: .utf8),
      let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let title = fields["title"] as? String,
      let body = fields["body"] as? String,
      !title.isEmpty
    else { return nil }
    self.title = title
    self.body = body
  }

  /// Whether the answer is the engine's own refusal, notifications off or an
  /// athlete who differs, which leaves the server's line standing.
  static func skips(_ json: String) -> Bool {
    guard
      let data = json.data(using: .utf8),
      let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }
    return fields["skip"] as? Bool == true
  }
}
