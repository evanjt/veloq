import ExpoModulesCore

/// Sets `NSURLIsExcludedFromBackupKey` on a path.
///
/// The attribute lives on the file system node, so a directory carries it for
/// everything beneath, and a directory made afresh starts without it. The
/// caller sets it each launch for that reason. A missing path is created here
/// as a directory: the tile store makes it on the first write, and an
/// attribute set before that write is the only way the first tile is covered.
/// A path that exists is marked as it stands, so a regular file is marked
/// rather than refused. `excludeExistingFromBackup` is the call for a file,
/// and never creates anything.
/// The answer is the attribute read back, not whether the write threw: a write
/// that succeeds on a node that then reads as included is the failure the
/// caller wants to hear about.
public final class VeloqBackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeloqBackupExclusion")

    Function("excludeFromBackup") { (path: String) throws -> Bool in
      let url = URL(fileURLWithPath: path)
      if !FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
      }
      return try Self.exclude(url)
    }

    // The core Image component's responses, a profile photo among them, sit in
    // the shared URL cache.
    Function("clearImageDiskCache") {
      URLCache.shared.removeAllCachedResponses()
    }

    Function("replaceFile") { (from: String, to: String) throws in
      try replaceFileAtomically(from: from, to: to)
    }

    // A file listed a moment ago can be gone by now, and a directory made in
    // its place would sit under its name, so a missing path is nil here.
    Function("excludeExistingFromBackup") { (path: String) throws -> Bool? in
      let url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return try Self.exclude(url)
    }

    // A backup folder the athlete picked, held by a bookmark from one launch to
    // the next. Every call that takes the bookmark answers with `bookmark` set
    // only when the system reported it stale, and the caller keeps that one.
    Function("bookmarkFolder") { (uri: String) throws -> String in
      guard let url = URL(string: uri), url.isFileURL else {
        throw Self.unavailable("not a file URL")
      }
      return try makeFolderBookmark(url).base64EncodedString()
    }

    Function("writeToBookmarkedFolder") {
      (bookmark: String, from: String, name: String) throws -> [String: Any] in
      let (_, refreshed) = try Self.inFolder(bookmark) {
        try copyIntoFolder($0, from: from, name: name)
      }
      return Self.answer(refreshed)
    }

    Function("listBookmarkedFolder") { (bookmark: String) throws -> [String: Any] in
      let (files, refreshed) = try Self.inFolder(bookmark) { try listFolder($0) }
      var answer = Self.answer(refreshed)
      answer["files"] = files.map { ["name": $0.name, "size": $0.size] as [String: Any] }
      return answer
    }

    Function("readFromBookmarkedFolder") {
      (bookmark: String, name: String, to: String) throws -> [String: Any] in
      let (_, refreshed) = try Self.inFolder(bookmark) {
        try copyOutOfFolder($0, name: name, to: to)
      }
      return Self.answer(refreshed)
    }
  }

  private static func inFolder<T>(_ bookmark: String, _ body: (URL) throws -> T) throws -> (
    T, Data?
  ) {
    guard let data = Data(base64Encoded: bookmark) else {
      throw unavailable("the bookmark is not base64")
    }
    do {
      return try withBookmarkedFolder(data, body)
    } catch let error as FolderUnavailable {
      throw unavailable(error.detail)
    }
  }

  private static func answer(_ refreshed: Data?) -> [String: Any] {
    guard let refreshed else { return [:] }
    return ["bookmark": refreshed.base64EncodedString()]
  }

  /// The JavaScript side reads this code as "choose the folder again".
  private static func unavailable(_ detail: String) -> Exception {
    Exception(name: "FolderUnavailable", description: detail, code: "ERR_FOLDER_UNAVAILABLE")
  }

  private static func exclude(_ path: URL) throws -> Bool {
    var url = path
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
    let read = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
    return read.isExcludedFromBackup ?? false
  }
}
