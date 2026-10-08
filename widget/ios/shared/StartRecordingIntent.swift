import AppIntents
import Foundation

/// What the Record control runs when it is tapped.
///
/// Compiled into the app and the widget extension both. An intent that opens the
/// app is refused when it runs in an extension ("openAppWhenRun is not supported
/// in extensions"), so the control's tap does nothing unless the app target also
/// declares it, and then the system runs it in the app. The link comes from the
/// shared snapshot reader, because the extension's widget model is not compiled
/// into the app, and the app opens it, as it does for the Siri phrase.
@available(iOS 18.0, *)
struct StartRecordingIntent: AppIntent {
  static var title: LocalizedStringResource = "Start recording"
  static var description = IntentDescription("Opens Veloq ready to record.")
  static var openAppWhenRun: Bool = true
  /// The App Shortcut already offers this action, so it stays out of the list.
  static var isDiscoverable: Bool = false

  @MainActor
  func perform() async throws -> some IntentResult {
    await RecordLinkOpener.open(AppShortcutSnapshot.lastRecordURL())
    return .result()
  }
}
