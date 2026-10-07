import Foundation

/// The App Group container, which is where the database was moved to so a
/// second process could reach it at all. An extension has no way into the
/// app's own Documents directory.
enum VeloqPaths {
  static let appGroup = "group.com.veloq.app"

  /// The database, or nil when the container is unreachable or the file is
  /// not there yet.
  ///
  /// Absent is the ordinary case on the launch after an upgrade: the app moves
  /// the file into the container on its next start, and until it has, the
  /// library is still in `Documents` where no extension can see it. Opening a
  /// path with nothing at it would create an empty database, index one ride
  /// into it and compare that ride against nothing, so the answer is to post
  /// what the server wrote and wait for the move.
  static func routeDatabase() -> String? {
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroup
      )
    else { return nil }
    let path = container.appendingPathComponent("routes.db").path
    return FileManager.default.fileExists(atPath: path) ? path : nil
  }
}

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
