//! How a file the engine serves while it may be rewritten reaches disk.
//!
//! The basemap store and the heatmap tiles both answer a reader from the file
//! a writer is replacing, and a process can be killed mid-write. Written in
//! place, the file is truncated before the new bytes land, so a reader or a
//! restart finds it empty or short and serves that.

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

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

/// How old a temp file must be before [`sweep_stale_temp_files`] removes it.
/// A live writer renames its temp file within moments of creating it, so an
/// entry this old belongs to a process that was killed.
pub(crate) const STALE_TEMP_AGE: Duration = Duration::from_secs(3600);

/// Remove the `*.tmp` files under `dir`, at any depth, last modified at least
/// `min_age` ago. They are what [`write_atomically`] strands when a process is
/// killed between the write and the rename. Younger entries are kept because a
/// writer may be about to rename them. Returns how many were removed; a
/// directory or entry that cannot be read is skipped.
pub(crate) fn sweep_stale_temp_files(dir: &Path, min_age: Duration) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            removed += sweep_stale_temp_files(&path, min_age);
        } else if kind.is_file()
            && path.extension().is_some_and(|e| e == "tmp")
            && entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age >= min_age)
            && std::fs::remove_file(&path).is_ok()
        {
            removed += 1;
        }
    }
    removed
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
    fn sweep_removes_stranded_temp_files_and_keeps_tiles() {
        let dir = tempfile::tempdir().unwrap();
        let column = dir.path().join("12").join("345");
        std::fs::create_dir_all(&column).unwrap();
        std::fs::write(column.join("6.png"), b"tile").unwrap();
        std::fs::write(column.join("6.png.3.tmp"), b"partial").unwrap();
        std::fs::write(dir.path().join("index.bin.0.tmp"), b"partial").unwrap();
        std::fs::write(dir.path().join("version.txt"), b"1").unwrap();

        assert_eq!(sweep_stale_temp_files(dir.path(), Duration::ZERO), 2);

        assert!(!column.join("6.png.3.tmp").exists());
        assert!(!dir.path().join("index.bin.0.tmp").exists());
        assert_eq!(std::fs::read(column.join("6.png")).unwrap(), b"tile");
        assert!(dir.path().join("version.txt").exists());
    }

    #[test]
    fn sweep_keeps_a_temp_file_younger_than_the_age() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("5.png.1.tmp"), b"in flight").unwrap();

        assert_eq!(sweep_stale_temp_files(dir.path(), STALE_TEMP_AGE), 0);
        assert!(dir.path().join("5.png.1.tmp").exists());
    }

    #[test]
    fn sweep_of_a_missing_directory_removes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            sweep_stale_temp_files(&dir.path().join("absent"), Duration::ZERO),
            0
        );
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
