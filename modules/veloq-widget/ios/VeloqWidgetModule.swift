import ExpoModulesCore
import WidgetKit

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
      WidgetSnapshotFile.write(Data(json.utf8))
      refreshSiriSports()
    }

    // The wipe deletes the file, so the widget draws its placeholder rather
    // than the previous athlete's last ride and wellness.
    Function("clearSnapshot") {
      WidgetSnapshotFile.remove()
    }

    Function("reloadWidgets") {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
