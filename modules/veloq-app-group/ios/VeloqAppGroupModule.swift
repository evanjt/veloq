import ExpoModulesCore

// The same identifier the widget writes its snapshot into and both
// entitlements declare, fixed across dev and prod like the iCloud container.
private let kAppGroup = "group.com.veloq.app"

/// Answers the shared container's path, with a trailing slash so a caller
/// joins a name onto it the way it joins one onto `documentDirectory`.
///
/// Nil when the entitlement is missing, which is what a caller wants: the
/// database then stays where it is rather than being copied somewhere no
/// process can read it back from.
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
  }
}
