import ActivityKit
import ExpoModulesCore

/// Bridges the recording session to ActivityKit.
///
/// The JS side owns the payload: it builds the ContentState, fits it under the 4 KB
/// ceiling and decides when to push. This module only encodes, requests and ends, so
/// the card can never disagree with the store about what a recording is.
public final class VeloqLiveActivityModule: Module {
  private var control: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("VeloqLiveActivity")

    Events("onControl")

    OnCreate {
      // A LiveActivityIntent runs in this process, not the extension, so the card's
      // pause button lands here as a notification and leaves as an event. The store
      // does the pausing, the same as a tap on the record screen.
      self.control = NotificationCenter.default.addObserver(
        forName: Notification.Name("VeloqRecordingControl"),
        object: nil,
        queue: .main
      ) { [weak self] note in
        let action = note.userInfo?["action"] as? String ?? "toggle"
        self?.sendEvent("onControl", ["action": action])
      }
    }

    OnDestroy {
      if let control = self.control {
        NotificationCenter.default.removeObserver(control)
      }
    }

    Function("isSupported") { () -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    Function("start") { (attributesJson: String, stateJson: String) -> String? in
      guard #available(iOS 16.2, *) else { return nil }
      guard
        let attributes = decode(VeloqRecordingAttributes.self, from: attributesJson),
        let state = decode(VeloqRecordingAttributes.ContentState.self, from: stateJson)
      else { return nil }

      // One card per recording. A second request would leave the first on the lock
      // screen with a clock nothing updates.
      if let existing = Activity<VeloqRecordingAttributes>.activities.first {
        return existing.id
      }
      return try? Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state, staleDate: nil)
      ).id
    }

    // update, end and endAll hand off to a Task rather than blocking: every one of
    // them is called from the JS thread, and ActivityKit's own calls are async.
    Function("update") { (stateJson: String) in
      guard #available(iOS 16.2, *) else { return }
      guard let state = decode(VeloqRecordingAttributes.ContentState.self, from: stateJson) else {
        return
      }
      Task {
        for activity in Activity<VeloqRecordingAttributes>.activities {
          await activity.update(ActivityContent(state: state, staleDate: nil))
        }
      }
    }

    Function("end") {
      guard #available(iOS 16.2, *) else { return }
      Task { await endAll() }
    }

    Function("endAll") {
      guard #available(iOS 16.2, *) else { return }
      Task { await endAll() }
    }
  }
}

private func decode<T: Decodable>(_ type: T.Type, from json: String) -> T? {
  guard let data = json.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(type, from: data)
}

/// Dismiss immediately rather than leaving the card up: a finished ride is a card
/// counting nothing, and the next launch's reap would be the only thing to clear it.
@available(iOS 16.2, *)
private func endAll() async {
  for activity in Activity<VeloqRecordingAttributes>.activities {
    await activity.end(nil, dismissalPolicy: .immediate)
  }
}
