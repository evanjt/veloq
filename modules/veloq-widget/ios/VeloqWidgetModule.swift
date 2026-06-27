import ExpoModulesCore
import WidgetKit

// Shared-container coordinates. These are infrastructure constants (not theme), so
// they live here and are mirrored by the widget extension's snapshot reader. The App
// Group is fixed across dev/prod, matching the iCloud container in with-icloud.js.
private let kAppGroup = "group.com.veloq.app"
private let kSnapshotFile = "widget-snapshot.json"

/// Bridges the JS snapshot pipeline to WidgetKit: writes the pre-formatted JSON into
/// the App Group container the widget extension reads, then asks WidgetKit to redraw.
/// The widget itself never computes — it only renders this file.
public final class VeloqWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeloqWidget")

    Function("writeSnapshot") { (json: String) in
      guard
        let dir = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: kAppGroup
        )
      else { return }
      let url = dir.appendingPathComponent(kSnapshotFile)
      try? Data(json.utf8).write(to: url, options: .atomic)
    }

    Function("reloadWidgets") {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
