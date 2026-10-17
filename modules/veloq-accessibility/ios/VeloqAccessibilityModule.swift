import ExpoModulesCore
import UIKit

/// The system's accessibility display settings, read synchronously because the
/// app's styles are built from them when their modules load. A change while the
/// app runs therefore shows at the next launch.
///
/// Bold Text is `UIAccessibility.isBoldTextEnabled`, which a bundled face does
/// not follow on its own. UIKit answers it on the main thread, and a function
/// is called from the JavaScript thread, so the read hops there when it has to.
///
/// Button Shapes is `UIAccessibility.buttonShapesEnabled`, which React Native
/// does not expose. A button reads it live, so a change is sent as an event.
public final class VeloqAccessibilityModule: Module {
  private var buttonShapesObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("VeloqAccessibility")

    Events("onButtonShapesChange")

    OnStartObserving("onButtonShapesChange") {
      guard self.buttonShapesObserver == nil else { return }
      self.buttonShapesObserver = NotificationCenter.default.addObserver(
        forName: UIAccessibility.buttonShapesEnabledStatusDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        let enabled = MainActor.assumeIsolated { UIAccessibility.buttonShapesEnabled }
        self?.sendEvent("onButtonShapesChange", ["enabled": enabled])
      }
    }

    OnStopObserving("onButtonShapesChange") {
      if let observer = self.buttonShapesObserver {
        NotificationCenter.default.removeObserver(observer)
        self.buttonShapesObserver = nil
      }
    }

    Function("boldText") { () -> Bool in
      Self.onMain { UIAccessibility.isBoldTextEnabled }
    }

    Function("buttonShapes") { () -> Bool in
      Self.onMain { UIAccessibility.buttonShapesEnabled }
    }
  }

  private static func onMain(_ read: @MainActor () -> Bool) -> Bool {
    if Thread.isMainThread {
      return MainActor.assumeIsolated(read)
    }
    return DispatchQueue.main.sync { MainActor.assumeIsolated(read) }
  }
}
