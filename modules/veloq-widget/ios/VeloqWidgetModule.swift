import ExpoModulesCore
import WidgetKit

// Shared-container coordinates. These are infrastructure constants (not theme), so
// they live here and are mirrored by the widget extension's snapshot reader. The App
// Group is fixed across dev/prod, matching the iCloud container in with-icloud.js.
private let kAppGroup = "group.com.veloq.app"
private let kSnapshotFile = "widget-snapshot.json"

/// The snapshot in the App Group container, or nil where the group is not entitled.
private func snapshotURL() -> URL? {
  FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: kAppGroup)?
    .appendingPathComponent(kSnapshotFile)
}

/// Tells Siri the athlete's sport set may have changed, so a spoken sport name
/// resolves against what is recorded now. The provider is in the app target,
/// which this pod cannot name, so it is called through the class the app
/// declares under this name.
private func refreshSiriSports() {
  let selector = NSSelectorFromString("refresh")
  guard let refresher = NSClassFromString("VeloqAppShortcutRefresher") as? NSObject.Type,
    refresher.responds(to: selector)
  else { return }
  refresher.perform(selector)
}

/// Bridges the JS snapshot pipeline to WidgetKit: writes the pre-formatted JSON into
/// the App Group container the widget extension reads, then asks WidgetKit to redraw.
/// The widget itself never computes, it only renders this file.
public final class VeloqWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeloqWidget")

    Function("writeSnapshot") { (json: String) in
      guard var url = snapshotURL() else { return }
      // An atomic write replaces the file, so the mark goes on after each write.
      // The snapshot is a summary of the athlete's data and stays out of the device backup.
      if (try? Data(json.utf8).write(to: url, options: .atomic)) != nil {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
      }
      refreshSiriSports()
    }

    // The wipe deletes the file, so the widget draws its placeholder rather
    // than the previous athlete's last ride and wellness.
    Function("clearSnapshot") {
      guard let url = snapshotURL() else { return }
      try? FileManager.default.removeItem(at: url)
    }

    Function("reloadWidgets") {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
