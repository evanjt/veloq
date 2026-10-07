import AppIntents
import Foundation

/// The sports the athlete records, read from the shared App Group container.
///
/// Compiled into the app and the widget extension both: the Siri phrase and the
/// configurable widget offer the same list, so the list has one reader. It is
/// the file every widget surface reads, decoded for the fields a sport choice
/// needs rather than through the whole widget model, which the app target does
/// not compile.
enum AppShortcutSnapshot {
  static let appGroup = "group.com.veloq.app"
  static let fileName = "widget-snapshot.json"

  struct Shortcut: Decodable {
    let type: String
    let label: String
    let url: String
  }

  private struct Envelope: Decodable {
    let recordShortcuts: [Shortcut]?
  }

  static func shortcuts() -> [Shortcut] {
    guard
      let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
      let data = try? Data(contentsOf: dir.appendingPathComponent(fileName)),
      let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
    else { return [] }
    return envelope.recordShortcuts ?? []
  }

  /// The link for the last sport recorded, or the picker when nothing has been.
  static func lastRecordURL() -> URL {
    RecordDeepLink.url(for: shortcuts().first?.url)
  }

  /// The sports whose name or type is the spoken text, or contains it. An exact
  /// match on either wins outright, so "run" does not also offer "trail run".
  static func shortcuts(matching spoken: String) -> [Shortcut] {
    let wanted = spoken.trimmingCharacters(in: .whitespaces)
    guard !wanted.isEmpty else { return shortcuts() }
    let all = shortcuts()
    let exact = all.filter {
      $0.label.caseInsensitiveCompare(wanted) == .orderedSame
        || $0.type.caseInsensitiveCompare(wanted) == .orderedSame
    }
    if !exact.isEmpty { return exact }
    return all.filter {
      $0.label.localizedCaseInsensitiveContains(wanted)
        || $0.type.localizedCaseInsensitiveContains(wanted)
    }
  }
}

/// One sport the athlete records, as a Siri phrase, the Shortcuts editor and the
/// widget's configure sheet offer it.
///
/// It is an `AppEntity` rather than an `AppEnum` because the sport set is
/// whatever this athlete has recorded, and an enum case carries a display name
/// that would be English in all seventeen locales unless each target shipped a
/// strings catalogue. The snapshot already names each sport in the athlete's own
/// language.
///
/// The identifier is the deep link rather than the sport's type, because
/// AppIntents keeps a configured entity by its identifier alone and re-resolves
/// it through the query on every timeline. Recents are capped at four, so a
/// sport a widget was configured with drops out of the snapshot's list, and an
/// identifier that only named the type would come back as nothing: that widget
/// would quietly start whatever was recorded last. The link carries both the
/// identity and the destination, and the app composed it, so nothing here
/// builds one.
@available(iOS 16.0, *)
struct RecordSportEntity: AppEntity {
  let id: String
  let label: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "Sport")
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(label)")
  }

  static var defaultQuery = RecordSportQuery()
}

@available(iOS 16.0, *)
struct RecordSportQuery: EntityStringQuery {
  /// What the configure sheet and Siri's learned values list: the sports this
  /// athlete records, named in the athlete's own language by the snapshot.
  func suggestedEntities() async throws -> [RecordSportEntity] {
    RecordSportQuery.recorded()
  }

  /// What a placed widget's configuration resolves back to. An identifier the
  /// snapshot no longer lists is answered rather than dropped, so the widget
  /// keeps its sport.
  func entities(for identifiers: [String]) async throws -> [RecordSportEntity] {
    let known = RecordSportQuery.recorded()
    return identifiers.map { id in
      known.first { $0.id == id }
        ?? RecordSportEntity(id: id, label: RecordSportQuery.sportName(from: id))
    }
  }

  /// What a spoken or typed sport name resolves to, against the translated
  /// labels and the raw types.
  func entities(matching string: String) async throws -> [RecordSportEntity] {
    AppShortcutSnapshot.shortcuts(matching: string).map {
      RecordSportEntity(id: $0.url, label: $0.label)
    }
  }

  static func recorded() -> [RecordSportEntity] {
    AppShortcutSnapshot.shortcuts().map { RecordSportEntity(id: $0.url, label: $0.label) }
  }

  /// The name for a sport the snapshot has forgotten, read back out of the link
  /// rather than composed. Untranslated, which is the honest answer once the
  /// translated one is gone, and it shows only in the configure sheet.
  static func sportName(from url: String) -> String {
    URL(string: url)?.lastPathComponent ?? url
  }
}
