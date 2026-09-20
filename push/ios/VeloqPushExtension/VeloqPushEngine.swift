import Foundation

/// The engine, as the extension reaches it: four C symbols out of the Rust
/// xcframework, with the ownership rules folded in so no call site repeats
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
  /// caller posts what it was given.
  static func prepare(databasePath: String, credentials: VeloqCredentials) -> Bool {
    withOptional(credentials.accessToken) { token in
      withOptional(credentials.apiKey) { key in
        credentials.athleteId.withCString { athlete in
          databasePath.withCString { path in
            veloq_push_prepare(path, token, key, athlete)
          }
        }
      }
    }
  }

  /// One activity push, end to end: the gate, the detail body, the track and
  /// its index, then the title and body to post. Nil when there is nothing
  /// worth posting, or when any step of it failed.
  ///
  /// One call rather than three, and the same entry the Android worker makes:
  /// the gate is read before anything is fetched, the detail body writes the
  /// metrics row the ladder needs to date a lap, and it carries the ride's
  /// name, which the push itself does not.
  static func sentence(activityId: String) -> VeloqSentence? {
    let json = activityId.withCString { id in
      take(veloq_push_activity(id))
    }
    guard let json else { return nil }
    return VeloqSentence(json: json)
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
  /// answer that will not parse is no answer: the caller posts what the
  /// server wrote rather than an empty line.
  init?(json: String) {
    guard
      let data = json.data(using: .utf8),
      let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let title = fields["title"] as? String,
      let body = fields["body"] as? String,
      !title.isEmpty,
      !body.isEmpty
    else { return nil }
    self.title = title
    self.body = body
  }
}
