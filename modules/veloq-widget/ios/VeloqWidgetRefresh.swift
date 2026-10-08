import BackgroundTasks
import ExpoModulesCore
import WidgetKit

/// Rewrites the widget snapshot while the app is closed.
///
/// The widget draws a file the app writes, and nothing else runs while the app
/// is closed, so an athlete who does not open Veloq for days sees the numbers
/// of the last foreground sync. The system grants this task on its own
/// schedule, so it is a request, never a guarantee. When it runs, the engine
/// opens on the App Group library, pulls the last fortnight of wellness and
/// composes the snapshot (`widget_refresh.rs`). Where the pull cannot land the
/// engine still composes from the stored rows and marks the snapshot as being
/// from the last sync, so the widget does not read as current.
///
/// Nothing is decided here: the engine says what to write, and this file only
/// reads the credential, calls it, writes the file and asks WidgetKit to redraw.
public final class VeloqWidgetRefreshSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // A handler has to be registered before launch finishes, or the system
    // terminates the app when it delivers the task.
    VeloqWidgetRefreshTask.register()
    return false
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    VeloqWidgetRefreshTask.schedule()
  }
}

enum VeloqWidgetRefreshTask {
  /// The identifier `BGTaskSchedulerPermittedIdentifiers` lists in the Info.plist
  /// as `$(PRODUCT_BUNDLE_IDENTIFIER).widget-refresh`.
  static let identifier = (Bundle.main.bundleIdentifier ?? "com.veloq.app") + ".widget-refresh"

  /// How soon the system may first run the task. It is the platform's earliest
  /// interval for an app refresh; the system decides the real time.
  private static let earliest: TimeInterval = 15 * 60

  static func register() {
    BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
      guard let refresh = task as? BGAppRefreshTask else {
        task.setTaskCompleted(success: false)
        return
      }
      run(refresh)
    }
  }

  static func schedule() {
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: earliest)
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("[widget] the refresh could not be scheduled: \(error)")
    }
  }

  private static func run(_ task: BGAppRefreshTask) {
    // Rescheduled first, so a run that is cut short still leaves the next one.
    schedule()

    let finish = OneShot()
    task.expirationHandler = {
      // Out of time: leave the file as it is. The engine call cannot be
      // cancelled, so its answer is discarded when it arrives.
      if finish.claim() { task.setTaskCompleted(success: false) }
    }

    // Off the main thread, because every engine call blocks for its whole
    // duration and the pull is a network round trip.
    DispatchQueue.global(qos: .utility).async {
      let snapshot = refreshedSnapshot()
      guard finish.claim() else { return }
      guard let snapshot, WidgetSnapshotFile.write(snapshot) else {
        task.setTaskCompleted(success: false)
        return
      }
      WidgetCenter.shared.reloadAllTimelines()
      task.setTaskCompleted(success: true)
    }
  }

  /// The snapshot the engine composed, as the file holds it, or nil when there
  /// is nothing to write: no library in the container yet, an engine that will
  /// not open, or an app that has never described the widget. A keychain that
  /// answers nothing (a phone not yet unlocked since boot) still gets a
  /// snapshot, composed from the stored rows and marked as such.
  private static func refreshedSnapshot() -> Data? {
    guard let database = WidgetSnapshotFile.databasePath else { return nil }
    let credentials = VeloqCredentials.read()
    let answer: String? = withOptionalCString(credentials?.accessToken) { token in
      withOptionalCString(credentials?.apiKey) { key in
        withOptionalCString(credentials?.athleteId) { athlete in
          database.withCString { path in
            guard let raw = veloq_widget_refresh(path, token, key, athlete) else { return nil }
            defer { veloq_push_string_free(raw) }
            return String(cString: raw)
          }
        }
      }
    }
    guard
      let answer,
      let envelope = try? JSONSerialization.jsonObject(with: Data(answer.utf8)) as? [String: Any],
      let snapshot = envelope["snapshot"],
      JSONSerialization.isValidJSONObject(snapshot)
    else { return nil }
    return try? JSONSerialization.data(withJSONObject: snapshot)
  }

  /// `withCString` for a value that may be absent: the crate reads null as "the
  /// keychain answered nothing".
  private static func withOptionalCString<R>(
    _ value: String?, _ body: (UnsafePointer<CChar>?) -> R
  ) -> R {
    guard let value else { return body(nil) }
    return value.withCString { body($0) }
  }
}

/// Whichever of the worker and the expiry handler claims it first acts, and the
/// other does nothing: the system treats a second completion as a programming
/// error.
private final class OneShot {
  private let lock = NSLock()
  private var claimed = false

  func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if claimed { return false }
    claimed = true
    return true
  }
}
