//! How a file the engine serves while it may be rewritten reaches disk.
//!
//! The basemap store and the heatmap tiles both answer a reader from the file
//! a writer is replacing, and a process can be killed mid-write. Written in
//! place, the file is truncated before the new bytes land, so a reader or a
//! restart finds it empty or short and serves that.

use crate::runtime::ASYNC_RUNTIME;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::task::JoinHandle;

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

/// Start the sweep of `dir` on the shared blocking pool and return at once.
///
/// The walk visits every directory of a tile tree, which on a cold launch is
/// long enough to hold the JS thread, so no caller runs it inline. The handle
/// is the only way to wait for the count.
pub(crate) fn sweep_stale_temp_files_in_background(
    dir: &Path,
    min_age: Duration,
) -> JoinHandle<usize> {
    let dir = dir.to_path_buf();
    ASYNC_RUNTIME.spawn_blocking(move || sweep_stale_temp_files(&dir, min_age))
}

/// Sweep the stale temp files under `dir` in the background, at the age
/// [`STALE_TEMP_AGE`], and drop the handle: nothing at launch reads the count.
///
/// Safe beside the store's other work. A temp file a live writer is about to
/// rename is younger than the age and so is never taken, and a clear that
/// removes a directory under the walk only makes the walk skip an entry it can
/// no longer read.
pub(crate) fn sweep_stale_temp_files_detached(dir: &Path) {
    let sweep = sweep_stale_temp_files_in_background(dir, STALE_TEMP_AGE);
    #[cfg(test)]
    sweep_probe::keep(dir, sweep);
    #[cfg(not(test))]
    drop(sweep);
}

/// Remove the `*.tmp` files under `dir`, at any depth, last modified at least
/// `min_age` ago. They are what [`write_atomically`] strands when a process is
/// killed between the write and the rename. Younger entries are kept because a
/// writer may be about to rename them. Returns how many were removed; a
/// directory or entry that cannot be read is skipped.
///
/// Blocking, and private: callers reach it through
/// [`sweep_stale_temp_files_in_background`] so a walk never holds a caller.
fn sweep_stale_temp_files(dir: &Path, min_age: Duration) -> usize {
    #[cfg(test)]
    sweep_probe::record_walk(dir);
    remove_stale_temp_files(dir, min_age)
}

fn remove_stale_temp_files(dir: &Path, min_age: Duration) -> usize {
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
            removed += remove_stale_temp_files(&path, min_age);
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

/// Test-side view of the sweeps the launch paths start: the thread each walk
/// ran on, and the handle of a background sweep for a test to await. Entries
/// are keyed by directory because tests share the process.
#[cfg(test)]
pub(crate) mod sweep_probe {
    use crate::poison::Recover;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::thread::ThreadId;
    use tokio::task::JoinHandle;

    static WALKS: Mutex<Vec<(PathBuf, ThreadId)>> = Mutex::new(Vec::new());
    static HANDLES: Mutex<Vec<(PathBuf, JoinHandle<usize>)>> = Mutex::new(Vec::new());

    pub(super) fn record_walk(dir: &Path) {
        WALKS
            .lock_recover()
            .push((dir.to_path_buf(), std::thread::current().id()));
    }

    pub(super) fn keep(dir: &Path, sweep: JoinHandle<usize>) {
        HANDLES.lock_recover().push((dir.to_path_buf(), sweep));
    }

    /// The thread the most recent walk over `dir` ran on, if one ran.
    pub(crate) fn walked_on(dir: &Path) -> Option<ThreadId> {
        WALKS
            .lock_recover()
            .iter()
            .rev()
            .find(|(walked, _)| walked == dir)
            .map(|(_, thread)| *thread)
    }

    /// Wait for the background sweep started over `dir`, if one was, and
    /// answer how many files it removed.
    pub(crate) fn await_sweep(dir: &Path) -> Option<usize> {
        let sweep = {
            let mut handles = HANDLES.lock_recover();
            let at = handles.iter().position(|(held, _)| held == dir)?;
            handles.remove(at).1
        };
        Some(crate::runtime::block_on(sweep).expect("the sweep finished"))
    }

    /// Plant a tile at `root/tile` beside a stranded `.tmp` for it, last
    /// modified two hours ago so the sweep's age gate takes it.
    pub(crate) fn plant_stale_temp(root: &Path, tile: &str) -> PathBuf {
        let tile_path = root.join(tile);
        std::fs::create_dir_all(tile_path.parent().unwrap()).unwrap();
        std::fs::write(&tile_path, b"tile").unwrap();
        let temp = PathBuf::from(format!("{}.0.tmp", tile_path.display()));
        std::fs::write(&temp, b"partial").unwrap();
        let two_hours_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(7200);
        std::fs::File::options()
            .write(true)
            .open(&temp)
            .unwrap()
            .set_modified(two_hours_ago)
            .unwrap();
        temp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn sweep_keeps_a_temp_file_younger_than_the_age() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("5.png.1.tmp"), b"in flight").unwrap();

        assert_eq!(sweep_stale_temp_files(dir.path(), STALE_TEMP_AGE), 0);
        assert!(dir.path().join("5.png.1.tmp").exists());
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn sweep_of_a_missing_directory_removes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            sweep_stale_temp_files(&dir.path().join("absent"), Duration::ZERO),
            0
        );
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
