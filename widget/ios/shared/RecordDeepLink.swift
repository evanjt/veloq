import Foundation

/// Where a record surface goes when it is tapped.
///
/// Compiled into both the app and the widget extension, because the App
/// Shortcut lives in the app and every widget surface lives in the extension,
/// and one rule is the point. The links themselves are composed in
/// `widgetSnapshot.ts` and carried on the snapshot, so nothing here builds a
/// URL: it reads one, and falls back to the picker when there is none.
enum RecordDeepLink {
  /// Force-unwrapped once, on a literal that cannot fail to parse, so no caller
  /// has to unwrap and none can invent a second fallback.
  static let picker = URL(string: "veloq://record")!

  static func url(for raw: String?) -> URL {
    guard let raw, let url = URL(string: raw) else { return picker }
    return url
  }
}
