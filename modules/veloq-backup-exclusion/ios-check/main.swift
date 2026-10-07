import Foundation

// Runs `replaceFileAtomically` against a scratch directory. Exits non-zero
// on the first expectation that does not hold.

func expect(_ condition: Bool, _ message: String) {
  if !condition {
    FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    exit(1)
  }
}

let root = FileManager.default.temporaryDirectory
  .appendingPathComponent("replace-file-check-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }

func write(_ name: String, _ text: String) -> String {
  let path = root.appendingPathComponent(name).path
  FileManager.default.createFile(atPath: path, contents: Data(text.utf8))
  return path
}
func read(_ path: String) -> String? {
  FileManager.default.contents(atPath: path).flatMap { String(data: $0, encoding: .utf8) }
}

// A rename over an existing file replaces it and consumes the source.
let oldSnapshot = write("snapshot.json", "old")
let newSnapshot = write("snapshot.json.tmp", "new")
try replaceFileAtomically(from: newSnapshot, to: oldSnapshot)
expect(read(oldSnapshot) == "new", "destination holds the replacement")
expect(!FileManager.default.fileExists(atPath: newSnapshot), "source is consumed")

// A rename to a destination that does not exist yet creates it.
let fresh = root.appendingPathComponent("fresh.json").path
let source = write("fresh.json.tmp", "first")
try replaceFileAtomically(from: source, to: fresh)
expect(read(fresh) == "first", "missing destination is created")

// A missing source throws and leaves the destination byte-identical.
let kept = write("kept.json", "keep me")
let missing = root.appendingPathComponent("absent.tmp").path
var thrown: NSError?
do {
  try replaceFileAtomically(from: missing, to: kept)
} catch {
  thrown = error as NSError
}
expect(thrown != nil, "missing source throws")
expect(thrown?.domain == NSPOSIXErrorDomain, "error is a POSIX error")
expect(thrown?.code == Int(ENOENT), "error code is ENOENT, got \(thrown?.code ?? -1)")
expect(read(kept) == "keep me", "destination is unchanged after a failed rename")

// A failure that is not a missing source: a directory cannot replace a file.
let dir = root.appendingPathComponent("a-directory").path
try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: false)
let target = write("target.json", "still here")
var dirThrown = false
do { try replaceFileAtomically(from: dir, to: target) } catch { dirThrown = true }
expect(dirThrown, "directory over file throws")
expect(read(target) == "still here", "file is unchanged after directory over file")

print("replaceFile checks passed")
