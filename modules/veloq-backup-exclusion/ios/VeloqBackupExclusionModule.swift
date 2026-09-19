import ExpoModulesCore

/// Sets `NSURLIsExcludedFromBackupKey` on a path.
///
/// The attribute lives on the file system node, so a directory carries it for
/// everything beneath, and a directory made afresh starts without it. The
/// caller sets it each launch for that reason. The directory is created here
/// when it is missing: the tile store makes it on the first write, and an
/// attribute set before that write is the only way the first tile is covered.
/// The answer is the attribute read back, not whether the write threw: a write
/// that succeeds on a node that then reads as included is the failure the
/// caller wants to hear about.
public final class VeloqBackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VeloqBackupExclusion")

    Function("excludeFromBackup") { (path: String) throws -> Bool in
      var url = URL(fileURLWithPath: path)
      try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      let read = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
      return read.isExcludedFromBackup ?? false
    }
  }
}
