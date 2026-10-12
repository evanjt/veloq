import ExpoModulesCore

/// Answers whether a forced render crash was requested, and spends the request.
///
/// Only the Debug configuration reads the request: the launch argument
/// `-VeloqForceRenderCrash YES` as `xcrun simctl launch` passes it, or the
/// bare key, from Maestro's `launchApp` arguments. A launch argument lasts one
/// launch, so a relaunch does not throw again, and within the launch it is
/// answered once. Any other configuration answers no.
public final class VeloqDebugCrashModule: Module {
  #if DEBUG
  private static var spent = false
  #endif

  public func definition() -> ModuleDefinition {
    Name("VeloqDebugCrash")

    Function("takeRequest") { () -> Bool in
      #if DEBUG
      if Self.spent { return false }
      Self.spent = true
      let key = "VeloqForceRenderCrash"
      let arguments = ProcessInfo.processInfo.arguments
      if let flag = arguments.firstIndex(of: "-" + key) {
        let value = arguments.index(after: flag)
        return value < arguments.endIndex && ["YES", "true", "1"].contains(arguments[value])
      }
      return arguments.contains(key)
      #else
      return false
      #endif
    }
  }
}
