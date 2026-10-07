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
    std::fs::write(&temp, bytes)?;
    match std::fs::rename(&temp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            Err(e)
        }
    }
}
