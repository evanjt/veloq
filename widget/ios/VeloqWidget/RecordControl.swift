import AppIntents
import SwiftUI
import WidgetKit

/// The Record button iOS 18 places in Control Centre, on the Lock Screen beside
/// the torch and the camera, and on the Action Button. It is a control in the
/// WidgetKit extension that already exists, not a target of its own, and it opens
/// the same deep link the widgets do, so one rule decides the sport.
@available(iOS 18.0, *)
struct StartRecordingIntent: AppIntent {
  static var title: LocalizedStringResource = "Start recording"
  static var description = IntentDescription("Opens Veloq with the ride already running.")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult & OpensIntent {
    return .result(opensIntent: OpenURLIntent(RecordDeepLink.url(for: WidgetSnapshotStore.load())))
  }
}

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
