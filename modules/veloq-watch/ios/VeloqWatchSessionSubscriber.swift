import ExpoModulesCore
import UIKit

/// Activates the watch session before launch finishes, so a message that
/// launched the app in the background is delivered to a delegate that exists.
public final class VeloqWatchSessionSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    VeloqWatchSession.shared.activate()
    return true
  }
}
