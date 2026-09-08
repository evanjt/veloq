import AppIntents
import Foundation

/// Veloq's action in Siri, Spotlight and the Shortcuts app.
///
/// The provider has to live in the app target rather than the widget extension:
/// that is what surfaces the phrase and what lets an automation include it. The
/// intent itself does nothing clever, it opens the same deep link a widget tap
/// opens, so one rule decides the sport and one screen starts the ride.
///
/// No sport parameter yet, deliberately. A parameterised version needs an
/// `AppEnum` over the recordable types with a display name per case, and those
/// names would be English in all seventeen locales unless the app target ships a
/// strings catalogue for them. The unparameterised phrase already gives an
/// athlete the automation they asked for, and picking a specific sport is still
/// possible today through a Shortcuts "Open URL" action.
@available(iOS 16.0, *)
struct StartRideIntent: AppIntent {
  static var title: LocalizedStringResource = "Start recording"
  static var description = IntentDescription("Opens Veloq with the ride already running.")
  static var openAppWhenRun: Bool = true

  /// `openAppWhenRun` brings Veloq to the front but says nothing about where to
  /// land, and `OpenURLIntent` is iOS 18 while the deployment target is 16.4.
  /// So on 18 the phrase opens an already running ride, and on 16 and 17 it
  /// opens the app, which is still the automation working.
  func perform() async throws -> some IntentResult {
    if #available(iOS 18.0, *) {
      return .result(opensIntent: OpenURLIntent(AppShortcutSnapshot.recordURL()))
    }
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
  }
}

/// The last sport the app published, read from the shared App Group container.
/// The same file every widget surface reads, decoded for the one field an
/// intent needs rather than through the whole widget model, which the app target
/// does not compile.
enum AppShortcutSnapshot {
  static let appGroup = "group.com.veloq.app"
  static let fileName = "widget-snapshot.json"

  private struct Envelope: Decodable {
    struct Shortcut: Decodable { let url: String }
    let recordShortcuts: [Shortcut]?
  }

  static func recordURL() -> URL {
    guard
      let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
      let data = try? Data(contentsOf: dir.appendingPathComponent(fileName)),
      let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
    else { return RecordDeepLink.picker }
    return RecordDeepLink.url(for: envelope.recordShortcuts?.first?.url)
  }
}
