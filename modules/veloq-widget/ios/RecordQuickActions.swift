import UIKit

/// The recent sports as Home Screen quick actions, from the same list the Android
/// launcher publishes as shortcuts.
///
/// Each item carries the deep link that opens the app ready to record, as the
/// widgets and the App Shortcut do, and draws the symbol for its sport category.
/// The list arrives composed, so nothing here maps a sport or builds a link. It
/// imports UIKit alone, so the widget tests compile it beside the widget sources.
enum RecordQuickActions {
  /// One type for every sport: the link in each item's user info says which.
  static let type = (Bundle.main.bundleIdentifier ?? "com.veloq.app") + ".record"

  private static let urlKey = "url"

  /// One item per entry, in the list's order. An entry with no sport or no link is
  /// dropped rather than published as an item that opens nothing, and an empty list
  /// is the empty set that clears the menu.
  static func items(_ entries: [[String: String]]) -> [UIApplicationShortcutItem] {
    entries.compactMap { entry in
      let sport = trimmed(entry["type"])
      let link = trimmed(entry["url"])
      guard !sport.isEmpty, !link.isEmpty, URL(string: link) != nil else { return nil }
      let label = trimmed(entry["label"])
      return UIApplicationShortcutItem(
        type: type,
        localizedTitle: label.isEmpty ? sport : label,
        localizedSubtitle: nil,
        icon: UIApplicationShortcutIcon(systemImageName: symbol(entry["glyph"])),
        userInfo: [urlKey: link as NSString]
      )
    }
  }

  /// The link a chosen item opens, or nil for an item this list did not publish.
  static func url(of item: UIApplicationShortcutItem) -> URL? {
    guard item.type == type, let link = item.userInfo?[urlKey] as? String else { return nil }
    return URL(string: link)
  }

  /// The SF Symbol for a sport family key; a key this build does not know draws
  /// the catch-all.
  static func symbol(_ category: String?) -> String {
    switch category {
    case "ride": return "figure.outdoor.cycle"
    case "winter": return "figure.skiing.downhill"
    case "run": return "figure.run"
    case "water": return "figure.pool.swim"
    case "foot": return "figure.walk"
    case "strength": return "dumbbell"
    default: return "waveform.path.ecg"
    }
  }

  private static func trimmed(_ value: String?) -> String {
    value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }
}
