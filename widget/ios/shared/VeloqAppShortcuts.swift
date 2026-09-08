import AppIntents
import Foundation

/// Veloq's action in Siri, Spotlight and the Shortcuts app.
///
/// The provider has to live in the app target rather than the widget extension:
/// that is what surfaces the phrase and what lets an automation include it. The
/// intent itself does nothing clever, it opens the same deep link a widget tap
/// opens, so one rule decides the sport and one screen starts the ride.
///
/// The sport is a parameter whose options come from the snapshot at runtime, not
/// an `AppEnum` compiled into the binary. An enum case carries a display name,
/// and those names would be English in all seventeen locales unless the app
/// target shipped a strings catalogue for them. The snapshot already carries
/// each sport's name in the athlete's own language, translated by the same
/// `activityTypes.*` keys the app uses, so reading them is both simpler and
/// correct where an enum would be neither.
@available(iOS 16.0, *)
struct StartRideIntent: AppIntent {
  static var title: LocalizedStringResource = "Start recording"
  static var description = IntentDescription("Opens Veloq with the ride already running.")
  static var openAppWhenRun: Bool = true

  /// Optional: a phrase that names no sport starts the last one recorded, which
  /// is what the widgets and the Control do.
  @Parameter(title: "Sport", optionsProvider: RecordSportOptions())
  var sport: String?

  /// `openAppWhenRun` brings Veloq to the front but says nothing about where to
  /// land, and `OpenURLIntent` is iOS 18 while the deployment target is 16.4.
  /// So on 18 the phrase opens an already running ride, and on 16 and 17 it
  /// opens the app, which is still the automation working.
  func perform() async throws -> some IntentResult {
    if #available(iOS 18.0, *) {
      return .result(opensIntent: OpenURLIntent(AppShortcutSnapshot.recordURL(named: sport)))
    }
    return .result()
  }
}

/// The sports the athlete actually records, named as the app names them. An
/// empty list is the honest answer before anything has been recorded: Shortcuts
/// then offers nothing to pick and the phrase falls back to the last sport,
/// which is also nothing, so it opens the picker.
@available(iOS 16.0, *)
struct RecordSportOptions: DynamicOptionsProvider {
  func results() async throws -> [String] {
    AppShortcutSnapshot.shortcuts().map(\.label)
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

  struct Shortcut: Decodable {
    let type: String
    let label: String
    let url: String
  }

  private struct Envelope: Decodable {
    let recordShortcuts: [Shortcut]?
  }

  static func shortcuts() -> [Shortcut] {
    guard
      let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
      let data = try? Data(contentsOf: dir.appendingPathComponent(fileName)),
      let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
    else { return [] }
    return envelope.recordShortcuts ?? []
  }

  /// The link for a named sport, or for the last one recorded when the phrase
  /// named none. A name that matches nothing is treated as no name rather than
  /// as an error: opening the last ride beats refusing the phrase.
  static func recordURL(named sport: String? = nil) -> URL {
    let all = shortcuts()
    let chosen =
      sport == nil
      ? all.first
      : all.first { $0.label.caseInsensitiveCompare(sport!) == .orderedSame }
        ?? all.first { $0.type.caseInsensitiveCompare(sport!) == .orderedSame }
        ?? all.first
    return RecordDeepLink.url(for: chosen?.url)
  }
}
