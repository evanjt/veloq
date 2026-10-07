//! The one place the engine locks a file.
//!
//! std's `File::lock` returns `Unsupported` on the Android target, which closed
//! the engine on every Android launch while every Linux test passed. `flock`
//! works on Android, iOS and the hosts the tests run on.

use std::fs::File;
use std::io;

/// Block until this process holds an exclusive lock on `file`. The lock goes
/// with the open file description, so dropping `file` releases it.
#[cfg(unix)]
pub(crate) fn lock_exclusive(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    loop {
        // SAFETY: the descriptor is borrowed from a live `File` for the call.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

#[cfg(not(unix))]
pub(crate) fn lock_exclusive(file: &File) -> io::Result<()> {
    file.lock()
}

#[cfg(all(test, unix))]
mod tests {
    use super::lock_exclusive;
    use std::fs::OpenOptions;
    use std::os::fd::AsRawFd;

    fn try_lock_elsewhere(path: &std::path::Path) -> bool {
        let other = OpenOptions::new().write(true).open(path).unwrap();
        // SAFETY: the descriptor is borrowed from `other` for the call.
        unsafe { libc::flock(other.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) == 0 }
    }

    #[test]
    fn excludes_a_second_opener_until_dropped() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("routes.db.init.lock");
        let held = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .unwrap();

        lock_exclusive(&held).unwrap();
        assert!(
            !try_lock_elsewhere(&path),
            "a second opener took the init lock while it was held"
        );

        drop(held);
        assert!(
            try_lock_elsewhere(&path),
            "the init lock outlived the file that held it"
        );
    }

    #[test]
    fn locks_again_after_release() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("routes.db.init.lock");
        for _ in 0..2 {
            let file = OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(&path)
                .unwrap();
            lock_exclusive(&file).unwrap();
        }
    }
}
