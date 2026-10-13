import ExpoModulesCore
import UIKit

/// Opens the link a chosen Home Screen quick action carries, the way the App
/// Shortcut opens its link, so a quick action reaches the recording screen by the
/// same route as every other record surface.
public final class VeloqQuickActionSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let url = RecordQuickActions.url(of: shortcutItem) else {
      completionHandler(false)
      return
    }
    application.open(url) { opened in completionHandler(opened) }
  }
}
