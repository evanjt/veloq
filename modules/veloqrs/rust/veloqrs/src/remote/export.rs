//! A library export a linked client reads from the phone.
//!
//! The export is far larger than a reply can be, so it leaves the phone the
//! way an import arrives: through a spool file under the files root. A client
//! asks `export.begin`, which starts the library writer on its own thread into
//! `exports/<export_id>.zip.part` and answers at once. `export.status` tells
//! how far the writer has got and, once the archive is whole, its length and
//! SHA-256. `export.read` answers a range of the finished file as raw frames,
//! and `export.done` deletes it.
//!
//! The phone keeps nothing about how much a client has read, so after a
//! dropped link the client reads on from its own byte count, after asking
//! `export.status` for the same `export_id` and digest to know the file is the
//! one it was reading. A spool nobody has read for [`STALE_AFTER`] is deleted
//! by [`sweep`], and a device's spools go with the device.
//!
//! A device has one export at a time: a `begin` while one is building is
//! refused, and a `begin` over a finished one replaces it.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use crate::persistence::export::BulkExportProgress;
use crate::persistence::library_export::{LibraryExportOptions, LibraryExportResult};

use super::import::{FREE_SPACE_MARGIN, MAX_BYTES, digest_of, files_root, hex};

/// Reads the bytes free on the volume the spools live on, `None` where that
/// cannot be read.
pub type FreeProbe = Arc<dyn Fn() -> Option<u64> + Send + Sync>;

/// The directory under the files root the spools live in.
pub const EXPORTS: &str = "exports";

/// The most bytes one `export.read` answers.
pub const MAX_READ: u64 = 1024 * 1024;

/// A finished archive: the writer's result and the SHA-256 the build thread
/// read from the file once it was whole.
pub struct Archive {
    pub result: LibraryExportResult,
    pub digest: std::io::Result<[u8; 32]>,
}

/// What a finished build reports, or why it failed.
pub type Built = Result<Archive, String>;

/// Asks a build whether it has finished: the outcome once, and `None` while it runs.
pub type Poll = Box<dyn FnMut() -> Option<Built> + Send>;

enum State {
    Building,
    Ready { sha256: String, bytes: u64 },
    Failed(String),
}

struct Export {
    id: String,
    /// The fingerprint of the device that began it, the only one that reads it.
    device: String,
    part: PathBuf,
    ready: PathBuf,
    progress: Arc<BulkExportProgress>,
    poll: Option<Poll>,
    rides: u32,
    state: State,
}

impl Export {
    fn file(&self) -> &Path {
        match self.state {
            State::Building => &self.part,
            _ => &self.ready,
        }
    }

    fn remove_files(&self) {
        let _ = std::fs::remove_file(&self.part);
        let _ = std::fs::remove_file(&self.ready);
    }
}

/// What `export.status` answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    /// `building`, `ready` or `failed`.
    pub state: &'static str,
    pub bytes: u64,
    pub rides: u32,
    pub rides_done: u32,
    pub sha256: Option<String>,
    pub error: Option<String>,
}

/// The exports in progress or waiting to be read.
#[derive(Default)]
pub struct Spools {
    exports: Vec<Export>,
}

static LAST_ID: AtomicU32 = AtomicU32::new(0);

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let count = LAST_ID.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}{count:04x}")
}

fn spool_dir(root: &Path) -> PathBuf {
    root.join(EXPORTS)
}

impl Spools {
    fn find(&mut self, device: &str, id: &str) -> Result<&mut Export, String> {
        self.exports
            .iter_mut()
            .find(|held| held.id == id && held.device == device)
            .ok_or_else(|| "no such export".to_owned())
    }

    /// Begin an export for `device`. `start` is given the file to write and
    /// the run's counters, and answers how to ask whether the build has
    /// finished. Refused with `busy` while the device's earlier export is
    /// still building, and when the free space less [`FREE_SPACE_MARGIN`] is
    /// nothing. The writer asks `free` again before each ride and fails the
    /// build, deleting the partial file, once it is no more than the margin.
    /// A finished export of the same device is replaced.
    pub fn begin(
        &mut self,
        root: &Path,
        device: &str,
        free: FreeProbe,
        start: impl FnOnce(&Path, Arc<BulkExportProgress>) -> Poll,
    ) -> Result<String, String> {
        if self
            .exports
            .iter()
            .any(|held| held.device == device && matches!(held.state, State::Building))
        {
            return Err("busy: an export from this device is still building".into());
        }
        if free().is_some_and(|free| free <= FREE_SPACE_MARGIN) {
            return Err("not enough free space on the phone for an export".into());
        }
        self.forget(device);
        let dir = spool_dir(root);
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let id = new_id();
        let part = dir.join(format!("{id}.zip.part"));
        let ready = dir.join(format!("{id}.zip"));
        let progress = Arc::new(BulkExportProgress::default());
        progress.set_guard(Box::new(move || {
            free()
                .is_some_and(|free| free <= FREE_SPACE_MARGIN)
                .then(|| "the phone ran out of free space while the export was building".into())
        }));
        let poll = start(&part, Arc::clone(&progress));
        self.exports.push(Export {
            id: id.clone(),
            device: device.to_owned(),
            part,
            ready,
            progress,
            poll: Some(poll),
            rides: 0,
            state: State::Building,
        });
        Ok(id)
    }

    /// Move a build that has finished on to ready, or to failed.
    fn settle(&mut self, device: &str, id: &str) -> Result<(), String> {
        let export = self.find(device, id)?;
        let Some(poll) = export.poll.as_mut() else {
            return Ok(());
        };
        let Some(outcome) = poll() else {
            return Ok(());
        };
        export.poll = None;
        export.state = match outcome {
            Err(error) => State::Failed(error),
            Ok(built) => {
                export.rides = built.result.rides;
                match seal(&export.part, &export.ready, built.digest) {
                    Ok((sha256, bytes)) => State::Ready { sha256, bytes },
                    Err(error) => State::Failed(error),
                }
            }
        };
        if matches!(export.state, State::Failed(_)) {
            export.remove_files();
        }
        Ok(())
    }

    fn describe(&mut self, device: &str, id: &str) -> Result<Status, String> {
        let export = self.find(device, id)?;
        let (rides_done, total) = export.progress.read();
        let rides = export.rides.max(total);
        let on_disk = std::fs::metadata(export.file()).map_or(0, |meta| meta.len());
        Ok(match &export.state {
            State::Building => Status {
                state: "building",
                bytes: on_disk,
                rides,
                rides_done,
                sha256: None,
                error: None,
            },
            State::Ready { sha256, bytes } => Status {
                state: "ready",
                bytes: *bytes,
                rides,
                rides_done: rides,
                sha256: Some(sha256.clone()),
                error: None,
            },
            State::Failed(error) => Status {
                state: "failed",
                bytes: 0,
                rides,
                rides_done,
                sha256: None,
                error: Some(error.clone()),
            },
        })
    }

    /// Delete `device`'s exports and their files, stopping a build in flight.
    pub fn forget(&mut self, device: &str) {
        let (gone, kept): (Vec<Export>, Vec<Export>) = std::mem::take(&mut self.exports)
            .into_iter()
            .partition(|held| held.device == device);
        self.exports = kept;
        for export in gone {
            export.progress.cancel();
            export.remove_files();
        }
    }

    /// Delete export `id` of `device`.
    pub fn done(&mut self, device: &str, id: &str) -> Result<(), String> {
        let at = self
            .exports
            .iter()
            .position(|held| held.id == id && held.device == device)
            .ok_or("no such export")?;
        let export = self.exports.remove(at);
        export.progress.cancel();
        export.remove_files();
        Ok(())
    }
}

/// Check a whole archive and move it to its read name: its length and digest.
fn seal(
    part: &Path,
    ready: &Path,
    digest: std::io::Result<[u8; 32]>,
) -> Result<(String, u64), String> {
    let digest = digest.map_err(|error| error.to_string())?;
    let size = std::fs::metadata(part)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_BYTES {
        return Err(format!("the archive is over {MAX_BYTES} bytes"));
    }
    std::fs::rename(part, ready).map_err(|error| error.to_string())?;
    Ok((hex(&digest), size))
}

/// `export.status` on a registry: poll the build and describe where it
/// stands. The digest was read on the build's own thread, so nothing here
/// reads the archive.
pub fn status_shared(registry: &Mutex<Spools>, device: &str, id: &str) -> Result<Status, String> {
    let mut held = registry.lock().unwrap_or_else(|e| e.into_inner());
    held.settle(device, id)?;
    held.describe(device, id)
}

/// `export.read` on a registry: up to [`MAX_READ`] bytes at `offset` of a
/// finished archive. Reading the file takes no lock, and a read counts as the
/// spool being in use, so [`sweep`] leaves it.
pub fn read_shared(
    registry: &Mutex<Spools>,
    device: &str,
    id: &str,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    if length == 0 || length > MAX_READ {
        return Err(format!("length must be 1 to {MAX_READ} bytes"));
    }
    let (path, bytes) = {
        let mut held = registry.lock().unwrap_or_else(|e| e.into_inner());
        let export = held.find(device, id)?;
        match &export.state {
            State::Ready { bytes, .. } => (export.ready.clone(), *bytes),
            State::Failed(error) => return Err(format!("the export failed: {error}")),
            State::Building => return Err("the export is still building".into()),
        }
    };
    if offset >= bytes {
        return Err(format!(
            "offset {offset} is at or past the end, {bytes} bytes"
        ));
    }
    let take = length.min(bytes - offset);
    let mut file = File::open(&path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let mut buffer = vec![0u8; usize::try_from(take).map_err(|error| error.to_string())?];
    file.read_exact(&mut buffer)
        .map_err(|error| error.to_string())?;
    let _ = file.set_modified(SystemTime::now());
    Ok(buffer)
}

/// Delete every file under `root`'s export directory that has not been
/// written or read for [`STALE_AFTER`] before `now`. Returns how many.
pub fn sweep(root: &Path, now: SystemTime) -> usize {
    super::import::sweep_dir(&spool_dir(root), now)
}

static SPOOLS: Mutex<Spools> = Mutex::new(Spools {
    exports: Vec::new(),
});

fn with_spools<R>(work: impl FnOnce(&mut Spools) -> R) -> R {
    let mut held = SPOOLS.lock().unwrap_or_else(|e| e.into_inner());
    work(&mut held)
}

/// Forget every export without touching any file, so a test starts with the
/// registry empty.
#[cfg(test)]
pub(crate) fn reset_for_test() {
    with_spools(|spools| {
        for export in spools.exports.drain(..) {
            export.progress.cancel();
        }
    });
}

/// Forget every export and delete every spool beside the database at
/// `db_path`, as a wipe of the library does.
pub fn forget_all_beside(db_path: &str) {
    with_spools(|spools| {
        for export in spools.exports.drain(..) {
            export.progress.cancel();
        }
    });
    let Some(dir) = Path::new(db_path)
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
    else {
        return;
    };
    let _ = std::fs::remove_dir_all(spool_dir(dir));
}

/// A build that reads the archive's digest on a thread of its own once the
/// writer has finished, so no ask worker ever hashes it.
fn hashed_on_own_thread(handle: crate::persistence::LibraryExportHandle, part: PathBuf) -> Poll {
    let (send, receive) = std::sync::mpsc::channel::<Built>();
    crate::threads::spawn_named("veloq-export-digest", move || {
        let built = handle
            .recv_blocking()
            .unwrap_or_else(|| Err("Export thread died without a result".to_owned()));
        let _ = send.send(built.map(|result| Archive {
            result,
            digest: digest_of(&part),
        }));
    });
    Box::new(move || receive.try_recv().ok())
}

/// `export.begin` for `device`: the library writer starts on its own thread
/// and its own connection, and takes no engine lock.
pub fn begin(device: &str, options: LibraryExportOptions) -> Result<String, String> {
    let (_, db_path) = crate::persistence::read_pool::binding().ok_or("engine not initialised")?;
    let root = files_root()?;
    let probe_root = root.clone();
    let free: FreeProbe = Arc::new(move || super::import::free_space(&probe_root));
    with_spools(|spools| {
        spools.begin(&root, device, free, |dest, progress| {
            let handle = crate::persistence::export::library_export_background(
                db_path,
                options,
                &dest.to_string_lossy(),
                progress,
            );
            hashed_on_own_thread(handle, dest.to_path_buf())
        })
    })
}

/// `export.status` for `device`.
pub fn status(device: &str, id: &str) -> Result<Status, String> {
    status_shared(&SPOOLS, device, id)
}

/// `export.read` for `device`.
pub fn read(device: &str, id: &str, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    read_shared(&SPOOLS, device, id, offset, length)
}

/// `export.done` for `device`.
pub fn done(device: &str, id: &str) -> Result<(), String> {
    with_spools(|spools| spools.done(device, id))
}

/// Forget every export `device` began, as an unlink does.
pub fn forget_device(device: &str) {
    with_spools(|spools| spools.forget(device));
}

/// Delete the spools nobody read for a day, which the link does as it starts.
pub fn sweep_stale() {
    if let Ok(root) = files_root() {
        sweep(&root, SystemTime::now());
    }
}

#[cfg(test)]
#[path = "tests/export.rs"]
mod tests;
