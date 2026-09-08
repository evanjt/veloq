import AppIntents
import Foundation

/// Names the app process listens on. The extension compiles this file too and the
/// post there goes nowhere, which is correct: a `LiveActivityIntent` runs in the app,
/// and the extension's copy exists only so the button can name the type.
extension Notification.Name {
  static let veloqRecordingControl = Notification.Name("VeloqRecordingControl")
}

/// The control the card carries. The intent does not touch the recording itself: it
/// signals the app, which owns the store, so one code path pauses a ride whether the
/// tap came from the lock screen or the record screen.
@available(iOS 17.0, *)
struct VeloqRecordingControlIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Recording control"
  static var isDiscoverable: Bool = false

  @Parameter(title: "Action")
  var action: String

  init() {
    action = "toggle"
  }

  init(action: String) {
    self.action = action
  }

  func perform() async throws -> some IntentResult {
    NotificationCenter.default.post(
      name: .veloqRecordingControl,
      object: nil,
      userInfo: ["action": action]
    )
    return .result()
  }
}
