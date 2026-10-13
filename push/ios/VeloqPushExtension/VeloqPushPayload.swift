import Foundation

/// What one push says, out of the payload Expo sends.
///
/// The developer data rides in the top-level `body` key of the APNs payload,
/// which is where `expo-notifications` reads it from on this platform
/// (its `NotificationRecords.swift`), so the extension reads it from the same
/// place rather than inventing a second shape. A payload that names it at the
/// root is read too, since that is what `xcrun simctl push` hands over when a
/// fixture is written by hand.
struct VeloqPushPayload {
  /// The events worth fetching for. Every other type the worker sends is a
  /// wellness or fitness update with no activity behind it.
  private static let enrichable: Set<String> = ["ACTIVITY_UPLOADED", "ACTIVITY_ANALYZED"]

  let activityId: String
  let athleteId: String

  /// Nil when this push is not one to enrich, which the caller delivers
  /// unchanged. That is a wellness event, a payload with no activity id, or
  /// anything whose shape the extension does not recognise.
  init?(userInfo: [AnyHashable: Any]) {
    let data = (userInfo["body"] as? [String: Any]) ?? Self.rootFields(userInfo)
    guard
      let eventType = data["event_type"] as? String,
      Self.enrichable.contains(eventType),
      let activityId = (data["activity_id"] as? String)?.trimmingCharacters(
        in: .whitespacesAndNewlines
      ),
      !activityId.isEmpty,
      let athleteId = (data["athlete_id"] as? String)?.trimmingCharacters(
        in: .whitespacesAndNewlines
      ),
      !athleteId.isEmpty
    else { return nil }
    self.activityId = activityId
    self.athleteId = athleteId
  }

  private static func rootFields(_ userInfo: [AnyHashable: Any]) -> [String: Any] {
    var fields: [String: Any] = [:]
    for (key, value) in userInfo {
      if let key = key as? String { fields[key] = value }
    }
    return fields
  }
}
