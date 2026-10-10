import ExpoModulesCore

// The same identifier the widget writes its snapshot into and both
// entitlements declare, fixed across dev and prod like the iCloud container.
private let kAppGroup = "group.com.veloq.app"

/// Answers the shared container's path, with a trailing slash so a caller
/// joins a name onto it the way it joins one onto `documentDirectory`, holds
/// the background tasks that keep the process alive while the engine releases
/// its locks on the library there, and asks the engine to release them.
///
/// The path is nil when the entitlement is missing, which is what a caller
/// wants: the database then stays where it is rather than being copied
/// somewhere no process can read it back from.
public final class VeloqAppGroupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeloqAppGroup")

    Function("containerPath") { () -> String? in
      guard
        let dir = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: kAppGroup
        )
      else { return nil }
      return dir.path.hasSuffix("/") ? dir.path : "\(dir.path)/"
    }

    // A window in which the process keeps running after the app leaves the
    // foreground, so the engine can end the writes it holds on the library
    // here before the system suspends it.
    Function("beginBackgroundTask") { (name: String) -> Int? in
      VeloqBackgroundTasks.begin(name)
    }

    Function("endBackgroundTask") { (id: Int) in
      VeloqBackgroundTasks.end(id)
    }

    // Stop the engine writing and wait up to `deadlineMs` for the writes in
    // flight to end, answering whether none is left open. An async function
    // runs off the main thread, so the wait blocks neither it nor JavaScript.
    AsyncFunction("prepareEngineForSuspension") { (deadlineMs: Int) -> Bool in
      veloq_engine_prepare_for_suspension(UInt32(clamping: max(deadlineMs, 0)))
    }
  }
}
