import Foundation

// Runs the backup folder helpers in `FolderBookmark.swift` against a scratch
// directory. Exits non-zero on the first expectation that does not hold.

func expect(_ condition: Bool, _ message: String) {
  if !condition {
    FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    exit(1)
  }
}

func expectUnavailable(_ message: String, _ body: () throws -> Void) {
  do {
    try body()
    expect(false, "\(message): no error")
  } catch is FolderUnavailable {
  } catch {
    expect(false, "\(message): \(error) is not FolderUnavailable")
  }
}

let root = FileManager.default.temporaryDirectory
  .appendingPathComponent("folder-bookmark-check-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }

let folder = root.appendingPathComponent("Training", isDirectory: true)
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
let zip = root.appendingPathComponent("veloq-decisions.zip").path
FileManager.default.createFile(atPath: zip, contents: Data([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))
let other = root.appendingPathComponent("other.zip").path
FileManager.default.createFile(atPath: other, contents: Data([9, 9]))

func contents(_ url: URL) -> Data? { FileManager.default.contents(atPath: url.path) }

let bookmark = try makeFolderBookmark(folder)

// A run copies the zip in under its own name, byte for byte.
let first = "veloq-2026-03-14T06-30-00-000Z.zip"
let (_, refreshed) = try withBookmarkedFolder(bookmark) {
  try copyIntoFolder($0, from: zip, name: first)
}
expect(refreshed == nil, "a fresh bookmark is not refreshed")
expect(contents(folder.appendingPathComponent(first)) == contents(URL(fileURLWithPath: zip)),
  "the folder holds the zip's bytes")

// A second run adds its own file and the first stays.
let second = "veloq-2026-03-15T06-30-00-000Z.zip"
_ = try withBookmarkedFolder(bookmark) { try copyIntoFolder($0, from: other, name: second) }
expect(contents(folder.appendingPathComponent(first)) != nil, "the first zip stays")
expect(contents(folder.appendingPathComponent(second)) == Data([9, 9]), "the second zip is added")

// A name already taken is refused and the file under it is untouched.
var refused = false
do {
  _ = try withBookmarkedFolder(bookmark) { try copyIntoFolder($0, from: other, name: first) }
} catch {
  refused = true
}
expect(refused, "copying over an existing name throws")
expect(contents(folder.appendingPathComponent(first)) == contents(URL(fileURLWithPath: zip)),
  "the existing file is unchanged")

// A missing source throws and leaves nothing behind.
var missingThrown = false
do {
  _ = try withBookmarkedFolder(bookmark) {
    try copyIntoFolder($0, from: root.appendingPathComponent("absent.zip").path, name: "veloq-x.zip")
  }
} catch {
  missingThrown = true
}
expect(missingThrown, "a missing source throws")
expect(!FileManager.default.fileExists(atPath: folder.appendingPathComponent("veloq-x.zip").path),
  "a failed copy leaves no file")

// The listing is the regular files with their sizes, and nothing hidden or nested.
try FileManager.default.createDirectory(
  at: folder.appendingPathComponent("nested"), withIntermediateDirectories: false)
FileManager.default.createFile(
  atPath: folder.appendingPathComponent(".hidden").path, contents: Data([1]))
let (listed, _) = try withBookmarkedFolder(bookmark) { try listFolder($0) }
let byName = Dictionary(uniqueKeysWithValues: listed.map { ($0.name, $0.size) })
expect(byName == [first: 7, second: 2], "the listing is the two zips, got \(byName)")

// A zip copied out replaces what is at the destination.
let restored = root.appendingPathComponent("restore.zip")
FileManager.default.createFile(atPath: restored.path, contents: Data([0]))
_ = try withBookmarkedFolder(bookmark) { try copyOutOfFolder($0, name: first, to: restored.path) }
expect(contents(restored) == contents(URL(fileURLWithPath: zip)), "the copy out holds the zip")

// A folder that was moved is still found through its bookmark.
let moved = root.appendingPathComponent("Moved", isDirectory: true)
try FileManager.default.moveItem(at: folder, to: moved)
let (movedList, movedRefresh) = try withBookmarkedFolder(bookmark) { try listFolder($0) }
expect(movedList.count == 2, "the moved folder lists its zips")
let current = movedRefresh ?? bookmark

// A folder that was deleted is out of reach, as is a bookmark that is not one.
try FileManager.default.removeItem(at: moved)
expectUnavailable("a deleted folder") { _ = try withBookmarkedFolder(current) { _ in () } }
expectUnavailable("bytes that are not a bookmark") {
  _ = try withBookmarkedFolder(Data([1, 2, 3])) { _ in () }
}

print("folder bookmark checks passed")
