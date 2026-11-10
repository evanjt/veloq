//! How a file the engine serves while it may be rewritten reaches disk.
//!
//! The basemap store and the heatmap tiles both answer a reader from the file
//! a writer is replacing, and a process can be killed mid-write. Written in
//! place, the file is truncated before the new bytes land, so a reader or a
//! restart finds it empty or short and serves that.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Install `bytes` at `path` through a temp file and a rename, so a kill
/// mid-write leaves the previous file rather than a truncated one.
///
/// The temp file is `path` with `.<n>.tmp` after its extension, so nothing
/// that looks a file up by its own name ever reads one.
pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // The counter keeps two writers of the same file off each other's temp
    // file, which would otherwise interleave into one truncated rename.
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let ticket = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let temp = path.with_extension(format!(
        "{}.{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or(""),
        ticket
    ));
    install_through(path, &temp, bytes, |temp, bytes| {
        std::fs::write(temp, bytes)
    })
}

/// The write-then-rename of [`write_atomically`], with the step that fills the
/// temp file passed in, so a test can make that step fail partway. A failure
/// at either step removes the temp file, because a write that ran out of space
/// has already put a partial file on disk.
fn install_through(
    path: &Path,
    temp: &Path,
    bytes: &[u8],
    write: impl FnOnce(&Path, &[u8]) -> io::Result<()>,
) -> io::Result<()> {
    let result = write(temp, bytes).and_then(|()| std::fs::rename(temp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_write_removes_partial_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("5.png");
        let temp = dir.path().join("5.png.0.tmp");
        std::fs::write(&path, b"previous").unwrap();

        let err = install_through(&path, &temp, b"replacement", |temp, bytes| {
            std::fs::write(temp, &bytes[..4])?;
            Err(io::Error::new(io::ErrorKind::StorageFull, "no space left"))
        })
        .unwrap_err();

        assert_eq!(err.kind(), io::ErrorKind::StorageFull);
        assert!(!temp.exists(), "partial temp file left behind");
        assert_eq!(std::fs::read(&path).unwrap(), b"previous");
    }

    #[test]
    fn successive_writes_replace_the_file_and_leave_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.bin");

        write_atomically(&path, b"first").unwrap();
        write_atomically(&path, b"second").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().file_name() != "index.bin")
            .count();
        assert_eq!(leftovers, 0);
    }
}
