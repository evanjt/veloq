import Foundation

/// `FileManager.moveItem` refuses an existing destination and the file
/// system API's move deletes it first, so a kill between the two loses the
/// old file. `rename(2)` replaces atomically on one volume, and a failure
/// leaves the destination untouched.
func replaceFileAtomically(from: String, to: String) throws {
  if rename(from, to) != 0 {
    let code = errno
    throw NSError(
      domain: NSPOSIXErrorDomain, code: Int(code),
      userInfo: [NSLocalizedDescriptionKey: String(cString: strerror(code))])
  }
}
