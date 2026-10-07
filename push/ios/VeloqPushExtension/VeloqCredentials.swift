import Foundation
import Security

/// The credential the app wrote, read out of the shared keychain group.
///
/// The extension is a different bundle id, so it sees the item only through
/// the App Group both targets declare, which iOS also counts as a keychain
/// access group, and only
/// from the first unlock after boot, which is what
/// `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` buys. Before that first unlock every
/// read comes back empty and the extension posts what the server wrote, which
/// is the deliberate fallback for that one state.
///
/// Which of the two secrets to use is not decided here: both are handed to
/// the crate, which picks the way `AuthStore` picks.
struct VeloqCredentials {
  let accessToken: String?
  let apiKey: String?
  let athleteId: String

  /// Nil when there is no athlete or no secret, which reads the same as a
  /// keychain that would not answer: there is nothing to sync as.
  static func read() -> VeloqCredentials? {
    guard let athleteId = VeloqKeychain.string(for: "intervals_athlete_id") else { return nil }
    let accessToken = VeloqKeychain.string(for: "intervals_access_token")
    let apiKey = VeloqKeychain.string(for: "intervals_api_key")
    if accessToken == nil && apiKey == nil { return nil }
    return VeloqCredentials(accessToken: accessToken, apiKey: apiKey, athleteId: athleteId)
  }
}

/// One keychain item, queried exactly the way `expo-secure-store` writes it.
///
/// The service carries the suffix the library appends for whether the item
/// needs authentication, and the three are tried in the order its own `get`
/// tries them, so an item written by an older version of the library still
/// reads. The account and the generic attribute are the key as raw bytes, not
/// as a string: that is what `SecureStoreModule.query` stores
/// (`node_modules/expo-secure-store/ios/SecureStoreModule.swift`), and a query
/// built with an `NSString` there matches nothing.
enum VeloqKeychain {
  /// The App Group id, which is also the access group: an App Group
  /// identifier is accepted as one without the team prefix, so no team id is
  /// pinned here or in `src/shared/app/credentialKeychain.ts`.
  static let accessGroup = "group.com.veloq.app"

  private static let services = ["app:no-auth", "app:auth", "app"]

  static func string(for key: String) -> String? {
    let encoded = Data(key.utf8)
    for service in services {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrGeneric as String: encoded,
        kSecAttrAccount as String: encoded,
        kSecAttrAccessGroup as String: accessGroup,
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecReturnData as String: kCFBooleanTrue as Any,
      ]
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
        let data = item as? Data,
        let value = String(data: data, encoding: .utf8)
      else { continue }
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty { return trimmed }
    }
    return nil
  }
}
