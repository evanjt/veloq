import Foundation

/// The widget snapshot in the App Group container: its location, and the one
/// write both the foreground bridge and the background refresh go through.
///
/// Shared-container coordinates are infrastructure constants (not theme). They
/// are mirrored by the widget extension's snapshot reader. The App Group is
/// fixed across dev/prod, matching the iCloud container in with-icloud.js.
enum WidgetSnapshotFile {
  static let appGroup = "group.com.veloq.app"
  static let fileName = "widget-snapshot.json"
  static let databaseName = "routes.db"

  /// The snapshot, or nil where the group is not entitled.
  static var url: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent(fileName)
  }

  /// The library, or nil when the container is unreachable or the file is not
  /// there yet. Opening a path with nothing at it would create an empty
  /// database, so the answer is to write nothing and wait for the app to move
  /// the library into the container.
  static var databasePath: String? {
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroup)
    else { return nil }
    let path = container.appendingPathComponent(databaseName).path
    return FileManager.default.fileExists(atPath: path) ? path : nil
  }

  /// Replace the snapshot. An atomic write replaces the file, so the backup
  /// mark goes on after each write: the snapshot is a summary of the athlete's
  /// data and stays out of the device backup.
  @discardableResult
  static func write(_ data: Data) -> Bool {
    guard var url else { return false }
    guard (try? data.write(to: url, options: .atomic)) != nil else { return false }
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
    return true
  }

  static func remove() {
    guard let url else { return }
    try? FileManager.default.removeItem(at: url)
  }
}
