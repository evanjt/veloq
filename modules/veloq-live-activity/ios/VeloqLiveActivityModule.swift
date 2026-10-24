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
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    Function("start") { (attributesJson: String, stateJson: String) -> String? in
      guard
        let attributes = decode(VeloqRecordingAttributes.self, from: attributesJson),
        let state = decode(VeloqRecordingAttributes.ContentState.self, from: stateJson)
      else { return nil }

      // One card per recording. A second request would leave the first on the lock
      // screen with a clock nothing updates. A stopped ride's card still on screen
      // is not that card: a resumed ride clears it and takes a live one.
      let activities = Activity<VeloqRecordingAttributes>.activities
      if let existing = activities.first(where: { $0.activityState == .active }) {
        return existing.id
      }
      let ended = activities.filter { $0.activityState != .active }
      if !ended.isEmpty {
        Task {
          for activity in ended { await activity.end(nil, dismissalPolicy: .immediate) }
        }
      }
      return try? Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state, staleDate: state.staleDate)
      ).id
    }

    // update, end and endAll hand off to a Task rather than blocking: every one of
    // them is called from the JS thread, and ActivityKit's own calls are async.
    Function("update") { (stateJson: String) in
      guard let state = decode(VeloqRecordingAttributes.ContentState.self, from: stateJson) else {
        return
      }
      Task {
        for activity in Activity<VeloqRecordingAttributes>.activities {
          await activity.update(ActivityContent(state: state, staleDate: state.staleDate))
        }
      }
    }

    // A final state leaves the card up on those figures until its stale date, then
    // the system dismisses it. Without one the card goes at once.
    Function("end") { (finalStateJson: String?) in
      guard
        let json = finalStateJson,
        let state = decode(VeloqRecordingAttributes.ContentState.self, from: json),
        let dismissAt = state.staleDate
      else {
        Task { await endAll() }
        return
      }
      Task {
        for activity in Activity<VeloqRecordingAttributes>.activities {
          await activity.end(
            ActivityContent(state: state, staleDate: state.staleDate),
            dismissalPolicy: .after(dismissAt)
          )
        }
      }
    }

    Function("endAll") {
      Task { await endAll() }
    }
  }
}

private func decode<T: Decodable>(_ type: T.Type, from json: String) -> T? {
  guard let data = json.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(type, from: data)
}

/// Dismiss immediately, ended or not: an orphan at launch is a card counting nothing,
/// and a stopped ride's card is cleared once the ride is saved or discarded.
private func endAll() async {
  for activity in Activity<VeloqRecordingAttributes>.activities {
    await activity.end(nil, dismissalPolicy: .immediate)
  }
}
