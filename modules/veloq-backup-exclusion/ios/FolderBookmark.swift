import Foundation

/// A bookmarked folder that cannot be used: the bookmark no longer resolves,
/// or it resolves to something that is not a folder the app can open. The
/// athlete has to choose the folder again, so the caller reports it as such.
struct FolderUnavailable: Error {
  let detail: String
}

/// A bookmark of a folder the document picker returned.
///
/// The picker's grant lasts only as long as the process, so a backup on a later
/// launch reaches the folder only through a bookmark made while that grant is
/// held. On iOS a bookmark made inside the grant carries it when resolved.
func makeFolderBookmark(_ folder: URL) throws -> Data {
  let accessed = folder.startAccessingSecurityScopedResource()
  defer { if accessed { folder.stopAccessingSecurityScopedResource() } }
  return try folder.bookmarkData(
    options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
}

/// Resolve a bookmark and open its folder for the length of `body`.
///
/// Returns what `body` returned and, when the system reports the bookmark
/// stale, a fresh one made while the folder is open, which the caller keeps in
/// place of the old. A folder that moved resolves to its new place.
func withBookmarkedFolder<T>(_ bookmark: Data, _ body: (URL) throws -> T) throws -> (T, Data?) {
  var stale = false
  let folder: URL
  do {
    folder = try URL(
      resolvingBookmarkData: bookmark, options: [], relativeTo: nil,
      bookmarkDataIsStale: &stale)
  } catch {
    throw FolderUnavailable(detail: error.localizedDescription)
  }
  let accessed = folder.startAccessingSecurityScopedResource()
  defer { if accessed { folder.stopAccessingSecurityScopedResource() } }

  var isDirectory: ObjCBool = false
  guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory),
    isDirectory.boolValue
  else {
    throw FolderUnavailable(detail: "the folder no longer exists")
  }
  // A folder outside the app's container opens only through its grant.
  guard accessed || FileManager.default.isReadableFile(atPath: folder.path) else {
    throw FolderUnavailable(detail: "the folder's access grant could not be taken")
  }

  let refreshed =
    stale
    ? try? folder.bookmarkData(
      options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
    : nil
  return (try body(folder), refreshed)
}

/// Run `body` under a file coordinator, which a folder in a cloud drive needs
/// so the provider sees a whole file rather than one being written.
private func coordinated(_ url: URL, writing: Bool, _ body: (URL) throws -> Void) throws {
  let coordinator = NSFileCoordinator(filePresenter: nil)
  var coordinationError: NSError?
  var bodyError: Error?
  let run = { (target: URL) in
    do { try body(target) } catch { bodyError = error }
  }
  if writing {
    coordinator.coordinate(
      writingItemAt: url, options: .forReplacing, error: &coordinationError, byAccessor: run)
  } else {
    coordinator.coordinate(
      readingItemAt: url, options: [], error: &coordinationError, byAccessor: run)
  }
  if let error = coordinationError { throw error }
  if let error = bodyError { throw error }
}

/// Copy a file into the folder under `name`. An existing file of that name is
/// left alone and the copy fails, since nothing in the folder is ours to
/// replace. A copy that fails part way takes its own partial file with it.
func copyIntoFolder(_ folder: URL, from source: String, name: String) throws {
  let target = folder.appendingPathComponent(name, isDirectory: false)
  try coordinated(target, writing: true) { url in
    do {
      try FileManager.default.copyItem(at: URL(fileURLWithPath: source), to: url)
    } catch {
      if (error as NSError).code != NSFileWriteFileExistsError {
        try? FileManager.default.removeItem(at: url)
      }
      throw error
    }
  }
}

/// The folder's regular files, by name and size in bytes.
func listFolder(_ folder: URL) throws -> [(name: String, size: Int)] {
  var files: [(name: String, size: Int)] = []
  try coordinated(folder, writing: false) { url in
    let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey]
    let children = try FileManager.default.contentsOfDirectory(
      at: url, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
    for child in children {
      let values = try child.resourceValues(forKeys: Set(keys))
      guard values.isRegularFile == true else { continue }
      files.append((name: child.lastPathComponent, size: values.fileSize ?? 0))
    }
  }
  return files
}

/// Copy the file `name` out of the folder to `destination`, replacing what is there.
func copyOutOfFolder(_ folder: URL, name: String, to destination: String) throws {
  let source = folder.appendingPathComponent(name, isDirectory: false)
  let target = URL(fileURLWithPath: destination)
  try coordinated(source, writing: false) { url in
    if FileManager.default.fileExists(atPath: target.path) {
      try FileManager.default.removeItem(at: target)
    }
    try FileManager.default.copyItem(at: url, to: target)
  }
}
