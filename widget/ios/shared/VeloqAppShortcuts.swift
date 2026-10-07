import AppIntents
import Foundation
import UIKit

/// Veloq's actions in Siri, Spotlight and the Shortcuts app.
///
/// The provider has to live in the app target rather than the widget extension:
/// that is what surfaces the phrase and what lets an automation include it. The
/// intents do nothing clever, they open the same deep link a widget tap opens,
/// so one rule decides the sport and the ride waits on the recording screen
/// for the athlete's Start.
///
/// The sport is an entity whose values come from the snapshot at runtime, not an
/// `AppEnum` compiled into the binary (see `RecordSportEntity`). A phrase can
/// only interpolate an entity or enum parameter, and Siri asks for a required
/// one when the phrase names none, so naming a sport is a second intent with a
/// required parameter and the sport-less phrases keep starting the last sport.
@available(iOS 16.0, *)
struct StartRideIntent: AppIntent {
  static var title: LocalizedStringResource = "Start recording"
  static var description = IntentDescription("Opens Veloq ready to record the last sport.")
  static var openAppWhenRun: Bool = true

  /// `openAppWhenRun` brings Veloq to the front but says nothing about where to
  /// land, and `OpenURLIntent` is iOS 18 while the deployment target is 16.4.
  /// So on 18 the intent hands the link to the system, and on 16 and 17 it opens
  /// the link on the app's own scheme from this process, which the app is
  /// already in, so it lands where a widget tap does.
  @MainActor
  func perform() async throws -> some IntentResult {
    let url = AppShortcutSnapshot.lastRecordURL()
    if #available(iOS 18.0, *) {
      return .result(opensIntent: OpenURLIntent(url))
    }
    await UIApplication.shared.open(url)
    return .result()
  }
}

/// Starts a named sport, which is what "start a swim" resolves to.
@available(iOS 16.0, *)
struct StartSportIntent: AppIntent {
  static var title: LocalizedStringResource = "Start a sport"
  static var description = IntentDescription("Opens Veloq ready to record the chosen sport.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Sport")
  var sport: RecordSportEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    let url = RecordDeepLink.url(for: sport.id)
    if #available(iOS 18.0, *) {
      return .result(opensIntent: OpenURLIntent(url))
    }
    await UIApplication.shared.open(url)
    return .result()
  }
}

@available(iOS 16.0, *)
struct VeloqAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartRideIntent(),
      phrases: [
        "Start a ride on \(.applicationName)",
        "Start recording on \(.applicationName)",
        "Start a \(.applicationName) ride",
      ],
      shortTitle: "Start recording",
      systemImageName: "record.circle"
    )
    AppShortcut(
      intent: StartSportIntent(),
      phrases: [
        "Start a \(\.$sport) on \(.applicationName)",
        "Record a \(\.$sport) on \(.applicationName)",
      ],
      shortTitle: "Start a sport",
      systemImageName: "figure.run"
    )
  }
}

/// Lets the snapshot writer tell Siri the sport set changed. The writer lives in
/// a pod that cannot name this target's provider, so it finds this class by name
/// at runtime; the name is fixed here so a rename cannot silently cut the link.
@objc(VeloqAppShortcutRefresher)
final class AppShortcutRefresher: NSObject {
  @objc static func refresh() {
    if #available(iOS 16.0, *) {
      VeloqAppShortcuts.updateAppShortcutParameters()
    }
  }
}
