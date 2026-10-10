import ExpoModulesCore
import UIKit

/// Tells the engine when the app moves between the foreground and the
/// background.
///
/// The library sits in the App Group container, and iOS terminates a
/// suspended app that still holds a lock on a file there. JavaScript stops the
/// engine writing once the app is in the background, after its own background
/// work, inside a background task (`src/shared/native/engineSuspension.ts`). The
/// engine refuses that unless this side has reported the background first, so
/// a request that arrives after the app has already come back cannot leave a
/// foreground engine that does not write. The resume is here rather than in
/// JavaScript because it has to land before any screen asks the engine for
/// anything on the way back.
public final class VeloqEngineSuspensionSubscriber: ExpoAppDelegateSubscriber {
  public func applicationDidEnterBackground(_ application: UIApplication) {
    veloq_engine_entered_background()
  }

  public func applicationWillEnterForeground(_ application: UIApplication) {
    veloq_engine_resume_after_suspension()
  }
}

/// Background tasks begun from JavaScript, by the raw id it holds.
enum VeloqBackgroundTasks {
  private static let lock = NSLock()
  private static var live = Set<Int>()

  /// Begin a task and answer its id, or nil when the system grants none. When
  /// the system's time runs out first the task is ended here, since one left
  /// open past its expiry ends the app.
  static func begin(_ name: String) -> Int? {
    var task = UIBackgroundTaskIdentifier.invalid
    task = UIApplication.shared.beginBackgroundTask(withName: name) {
      end(task.rawValue)
    }
    guard task != .invalid else { return nil }
    lock.lock()
    live.insert(task.rawValue)
    lock.unlock()
    return task.rawValue
  }

  /// End a task once, whichever of the caller and the expiry gets here first.
  static func end(_ raw: Int) {
    lock.lock()
    let wasLive = live.remove(raw) != nil
    lock.unlock()
    guard wasLive else { return }
    UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: raw))
  }
}
