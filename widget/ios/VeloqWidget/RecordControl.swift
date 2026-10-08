import AppIntents
import SwiftUI
import WidgetKit

/// The Record button iOS 18 places in Control Centre, on the Lock Screen beside
/// the torch and the camera, and on the Action Button. It is a control in the
/// WidgetKit extension that already exists, not a target of its own, and it opens
/// the same deep link the widgets do, so one rule decides the sport. Its intent
/// is in `StartRecordingIntent.swift`, shared with the app, which runs it.
@available(iOS 18.0, *)
struct VeloqRecordControl: ControlWidget {
  static let kind = "com.veloq.app.RecordControl"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: StartRecordingIntent()) {
        Label("Record", systemImage: "record.circle")
      }
    }
    .displayName("Record")
    .description("Start recording an activity.")
  }
}

/// The extension's side of the app's `RecordLinkOpener`. The Control's intent
/// opens the app, so the system runs it there and this is never called. It
/// exists because the shared intent is compiled here too.
enum RecordLinkOpener {
  @MainActor
  static func open(_ url: URL) async {}
}
