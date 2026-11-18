import ExpoModulesCore

/// The JavaScript face of the watch link. Every payload is the reply text of a
/// link read, and every ask is a link request, so JavaScript carries text and
/// the engine decides what it means.
public final class VeloqWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeloqWatch")

    Events("onHello")

    OnCreate {
      VeloqWatchSession.shared.onHello = { [weak self] request, reply in
        self?.sendEvent("onHello", ["request": request, "reply": reply])
      }
    }

    Function("state") { () -> [String: Any] in
      var state = VeloqWatchSession.shared.state()
      state["enabled"] = VeloqWatchSession.shared.enabled
      return state
    }

    Function("setEnabled") { (enabled: Bool) in
      VeloqWatchSession.shared.enabled = enabled
    }

    Function("updateNearby") { (reply: String) in
      try VeloqWatchSession.shared.updateNearby(reply)
    }

    Function("sendSection") { (reply: String) in
      try VeloqWatchSession.shared.sendSection(reply)
    }

    Function("sendFile") { (path: String, metadata: [String: String]) in
      VeloqWatchSession.shared.sendFile(path, metadata: metadata)
    }

    AsyncFunction("sendMessage") { (request: String, promise: Promise) in
      VeloqWatchSession.shared.sendMessage(request) { reply, error in
        if let reply { promise.resolve(reply) } else { promise.reject("E_WATCH", error ?? "no reply") }
      }
    }
  }
}
