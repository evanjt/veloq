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
struct StartRideIntent: AppIntent {
  static var title: LocalizedStringResource = "Start recording"
  static var description = IntentDescription("Opens Veloq ready to record the last sport.")
  static var openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult {
    await RecordLinkOpener.open(AppShortcutSnapshot.lastRecordURL())
    return .result()
  }
}

/// Starts a named sport, which is what "start a swim" resolves to.
struct StartSportIntent: AppIntent {
  static var title: LocalizedStringResource = "Start a sport"
  static var description = IntentDescription("Opens Veloq ready to record the chosen sport.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Sport")
  var sport: RecordSportEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    await RecordLinkOpener.open(RecordDeepLink.url(for: sport.id))
    return .result()
  }
}

/// Opens a record link from an intent the app runs, so it lands where a widget
/// tap does. `openAppWhenRun` brings Veloq to the front but says nothing about
/// where to land, and `OpenURLIntent` opens universal links only: handed a link
/// on the app's own scheme it brought the app forward and dropped the link. The
/// extension declares its own, which never runs, because the Control's intent is
/// compiled there too and `UIApplication.shared` is not available to it.
enum RecordLinkOpener {
  @MainActor
  static func open(_ url: URL) async {
    await UIApplication.shared.open(url)
  }
}

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
    VeloqAppShortcuts.updateAppShortcutParameters()
  }
}
