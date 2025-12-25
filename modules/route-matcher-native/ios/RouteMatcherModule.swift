import ExpoModulesCore

/**
 * Route Matcher native module stub.
 *
 * The Rust native library is not yet compiled for iOS.
 * All functions return null/empty to indicate native is unavailable,
 * and the JS fallback implementation will be used instead.
 *
 * To enable native performance:
 * 1. Build the Rust library: cd rust/route-matcher && ./scripts/build-ios.sh
 * 2. Copy the generated XCFramework and Swift bindings
 * 3. Replace this stub with the full implementation
 */
public class RouteMatcherModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RouteMatcher")

    // All functions return null to indicate native is not available
    // The TypeScript layer will fall back to the JS implementation

    Function("createSignature") { (activityId: String, points: [[String: Double]], config: [String: Any]?) -> [String: Any]? in
      return nil
    }

    Function("compareRoutes") { (sig1: [String: Any], sig2: [String: Any], config: [String: Any]?) -> [String: Any]? in
      return nil
    }

    Function("groupSignatures") { (signatures: [[String: Any]], config: [String: Any]?) -> [[String: Any]] in
      return []
    }

    Function("getDefaultConfig") { () -> [String: Any] in
      return [
        "maxFrechetDistance": 100.0,
        "minMatchPercentage": 80.0,
        "simplificationTolerance": 0.0001,
        "maxSimplifiedPoints": 50
      ]
    }
  }
}
