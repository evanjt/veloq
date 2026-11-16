//! Rides read from files that no connector can serve again.
//!
//! The athlete hands over a directory, a FIT, a gzipped FIT, a zip, or a zip
//! of zips, and each FIT in it becomes a row keyed by its bytes
//! (`origin::file_source_key`), with the file itself kept as the ride's
//! original. The same bytes arriving twice are one row, and so is the same
//! ride arriving as a different file (`ride_identity`): a file whose ride the
//! library already holds under another row is not stored, and is kept as that
//! row's original when it is the fuller one.
//!
//! The job runs on a thread of its own and holds the engine for one file at a
//! time. After each entry it writes the entry's number and the collection's
//! identity to settings rows, so a kill, or a cancel, resumes at the next entry
//! of the same collection and a different collection starts at its first. The
//! rows are device state and never travel in a backup.
//!
//! What the stored rides owe the library (their scores, the curves, the
//! fitness series) is worked out once per hundred files and once at the end,
//! not after each file, since that work grows with the library. A file that
//! does not decode is recorded against its key and the job goes on.

mod gpx;
mod tcx;
mod walk;
mod xml_ride;

use crate::net::garmin::ingest::{
    IngestError, Ingested, Kept, Prepared, finish_batch_for, link_to_row, prepare_activity,
    prepare_file, same_ride, settle,
};
use crate::persistence::origin::file_source_key;
use crate::persistence::ride_identity::Existing;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use walk::Entry;

/// The collection the checkpoint belongs to.
pub(crate) const CHECKPOINT_COLLECTION: &str = "veloq-import-collection";
/// The number of the next entry to read in that collection.
pub(crate) const CHECKPOINT_NEXT: &str = "veloq-import-next";

/// The settings rows a job keeps, which a record backup leaves out.
pub(crate) const SETTING_KEYS: [&str; 2] = [CHECKPOINT_COLLECTION, CHECKPOINT_NEXT];

/// What the originals table calls a ride that came from a file.
const ORIGIN: &str = "file";

/// Stored files after which the batch is settled before the walk goes on.
const FILES_PER_BATCH: usize = 100;

/// Failures kept by name for the screen. The count is exact past this.
const MAX_LISTED_FAILURES: usize = 200;

/// A file that did not become a ride, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    /// The file, as the collection names it.
    pub name: String,
    /// The key it was recorded against, `None` when its bytes could not be
    /// read and so no key could be made.
    pub key: Option<String>,
    pub reason: String,
}

/// What a job has walked.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Progress {
    /// Entries read by this job.
    pub seen: u32,
    /// New rows.
    pub stored: u32,
    /// Files whose ride the library already holds, by the same bytes or as a
    /// row under another key.
    pub already_stored: u32,
    /// Files stored as a row of their own although more than one row could be
    /// their ride, so none was chosen.
    pub ambiguous: u32,
    /// Files that did not decode or store, or could not be read.
    pub failed: u32,
    /// Always zero: a GPX or TCX is decoded and counted as stored, already
    /// stored or failed like a FIT. The field stays for the binding.
    pub other_format: u32,
    /// Files that are not rides.
    pub skipped: u32,
    /// The entry being worked on, or the last one.
    pub current: Option<String>,
    /// The first [`MAX_LISTED_FAILURES`] failures.
    pub failures: Vec<Failure>,
}

/// Why a job ended before the collection did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Halt {
    /// Stopped by the athlete. What is stored stays.
    Cancelled,
    /// The collection could not be read.
    Unreadable(String),
    /// The library the job writes into is gone or not yet known.
    Unstorable,
}

/// Where the job stands, for the screen to show.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum State {
    #[default]
    Idle,
    Running,
    Done,
    Stopped(Halt),
}

/// The state and what the job has walked, in this process.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub state: State,
    pub progress: Progress,
}

static SNAPSHOT: Mutex<Option<Snapshot>> = Mutex::new(None);
static ACTIVE: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

fn publish(snapshot: Snapshot) {
    *SNAPSHOT.lock().unwrap_or_else(|e| e.into_inner()) = Some(snapshot);
}

/// The one place the job takes the engine's write lock: for a file's row and
/// its checkpoint, a batch's settling, and the checkpoint's reset.
fn write<R>(
    install: u64,
    work: impl FnOnce(&mut crate::persistence::PersistentEngine) -> R,
) -> Option<R> {
    crate::persistence::with_persistent_engine_for(install, work)
}

/// The job's progress in this process.
pub fn progress_now() -> Snapshot {
    SNAPSHOT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or_default()
}

/// The right to run the one importer, released when dropped.
struct Claim;

impl Drop for Claim {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// One importer at a time, and none while the Garmin pull runs: both write
/// rows and settle the library's curves.
fn claim() -> Option<Claim> {
    if crate::net::garmin::pull::is_active() {
        return None;
    }
    (!ACTIVE.swap(true, Ordering::SeqCst)).then_some(Claim)
}

/// Start importing the collection at `path` into the library open at
/// `install`, on a thread of its own. Returns whether a job started.
pub fn start(install: u64, path: PathBuf) -> bool {
    let Some(claim) = claim() else {
        return false;
    };
    CANCEL.store(false, Ordering::SeqCst);
    publish(Snapshot {
        state: State::Running,
        progress: Progress::default(),
    });
    crate::threads::spawn_named("veloq-import", move || {
        let _claim = claim;
        let last = Mutex::new(Progress::default());
        let outcome = import_with(install, &path, &CANCEL, |progress| {
            *last.lock().unwrap_or_else(|e| e.into_inner()) = progress.clone();
            publish(Snapshot {
                state: State::Running,
                progress: progress.clone(),
            });
        });
        let (state, progress) = match outcome {
            Ok(progress) => (State::Done, progress),
            Err((halt, progress)) => (State::Stopped(halt), progress),
        };
        publish(Snapshot { state, progress });
    });
    true
}

/// Stop the job at its next entry. What is stored stays, and the checkpoint
/// with it.
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// [`import_with`] for a caller that wants the walk and nothing more.
pub fn import_collection(install: u64, path: &Path) -> Result<Progress, Halt> {
    import_with(install, path, &CANCEL, |_| {}).map_err(|(halt, _)| halt)
}

/// Import the collection at `path`, calling `after_file` with the progress
/// after each entry. Stops when `cancel` is set, before the next entry.
///
/// The error carries the progress made before it, since a cancel has stored
/// rides.
pub(crate) fn import_with(
    install: u64,
    path: &Path,
    cancel: &AtomicBool,
    mut after_file: impl FnMut(&Progress),
) -> Result<Progress, (Halt, Progress)> {
    let mut progress = Progress::default();
    let fail = |halt: Halt, progress: &Progress| (halt, progress.clone());
    let collection = match walk::identity(path) {
        Ok(collection) => collection,
        Err(e) => return Err(fail(Halt::Unreadable(e.0), &progress)),
    };
    let resume_at =
        checkpoint(install, &collection).ok_or_else(|| fail(Halt::Unstorable, &progress))?;

    let mut batch = Batch::default();
    let mut halt = None;
    let walked = walk::walk(path, resume_at, &mut |index, entry| {
        if cancel.load(Ordering::SeqCst) {
            halt = Some(Halt::Cancelled);
            return ControlFlow::Break(());
        }
        progress.seen += 1;
        match settle_entry(install, entry, &mut progress, &mut batch, index + 1) {
            Ok(()) => {}
            Err(stop) => {
                halt = Some(stop);
                return ControlFlow::Break(());
            }
        }
        if batch.keys.len() >= FILES_PER_BATCH {
            batch.finish(install);
        }
        after_file(&progress);
        ControlFlow::Continue(())
    });
    batch.finish(install);
    batch.condition(install);

    match (walked, halt) {
        (Err(e), _) => Err(fail(Halt::Unreadable(e.0), &progress)),
        (Ok(_), Some(halt)) => Err((halt, progress)),
        (Ok(_), None) => {
            forget_checkpoint(install);
            Ok(progress)
        }
    }
}

/// Stored rows not yet settled.
#[derive(Default)]
struct Batch {
    keys: Vec<String>,
    tracked: u32,
}

impl Batch {
    fn finish(&mut self, install: u64) {
        if self.keys.is_empty() {
            return;
        }
        let keys = std::mem::take(&mut self.keys);
        if !finish_batch_for(install, &keys) {
            log::warn!("veloqrs: [import] a batch was not settled: the engine closed");
        }
    }

    /// Note the tracked rows once for section detection and let it run.
    fn condition(&mut self, install: u64) {
        if self.tracked == 0 {
            return;
        }
        use crate::persistence::sections::conditioning;
        conditioning::note_stored_for(install, std::mem::take(&mut self.tracked));
        conditioning::condition_pending();
    }
}

/// The entry to resume at: where the checkpoint stands when it belongs to this
/// collection, else the start, with the checkpoint reset to this collection.
/// `None` when the library is closed.
fn checkpoint(install: u64, collection: &str) -> Option<u64> {
    write(install, |e| {
        let same = e
            .get_setting(CHECKPOINT_COLLECTION)
            .ok()
            .flatten()
            .as_deref()
            == Some(collection);
        let next = same
            .then(|| e.get_setting(CHECKPOINT_NEXT).ok().flatten())
            .flatten()
            .and_then(|n| n.parse().ok())
            .unwrap_or(0);
        if !same {
            let _ = e.set_setting(CHECKPOINT_COLLECTION, collection);
            let _ = e.set_setting(CHECKPOINT_NEXT, "0");
        }
        next
    })
}

fn forget_checkpoint(install: u64) {
    let _ = write(install, |e| {
        for key in SETTING_KEYS {
            let _ = e.delete_setting(key);
        }
    });
}

/// Whether the library holds a row under `key`, read off the engine's lock.
/// The store checks again, so this only spares the decode of a repeat.
fn holds(key: &str) -> bool {
    crate::objects::error::with_reader(|conn| {
        conn.query_row(
            "SELECT 1 FROM activity_bodies WHERE activity_id = ?1",
            [key],
            |_| Ok(()),
        )
        .is_ok()
    })
    .unwrap_or(false)
}

fn note_failure(progress: &mut Progress, name: &str, key: Option<String>, reason: String) {
    progress.failed += 1;
    if progress.failures.len() < MAX_LISTED_FAILURES {
        progress.failures.push(Failure {
            name: name.to_string(),
            key,
            reason,
        });
    }
}

/// Count one entry and store what it is, then move the checkpoint past it.
fn settle_entry(
    install: u64,
    entry: Entry,
    progress: &mut Progress,
    batch: &mut Batch,
    next: u64,
) -> Result<(), Halt> {
    match entry {
        Entry::Skipped { name } => {
            progress.skipped += 1;
            progress.current = Some(name);
        }
        Entry::OtherFormat { name, bytes } => {
            progress.current = Some(name.clone());
            match bytes {
                Err(reason) => note_failure(progress, &name, None, reason),
                Ok(bytes) => store_file(install, &name, &bytes, progress, batch)?,
            }
        }
        Entry::Fit { name, bytes } => {
            progress.current = Some(name.clone());
            match bytes {
                Err(reason) => note_failure(progress, &name, None, reason),
                Ok(bytes) => store_file(install, &name, &bytes, progress, batch)?,
            }
        }
    }
    let written = write(install, |e| {
        e.set_setting(CHECKPOINT_NEXT, &next.to_string())
    });
    if written.is_none() {
        return Err(Halt::Unstorable);
    }
    Ok(())
}

/// Decode `bytes` as the format they are: a GPX or TCX by the root element at
/// their head, else a FIT.
fn prepare_any(key: &str, bytes: &[u8]) -> Result<Prepared, IngestError> {
    if !walk::has_xml_ride_root(bytes) {
        return prepare_file(key, bytes);
    }
    let head = &bytes[..bytes.len().min(2048)];
    let is_gpx = head.windows(4).any(|w| w == b"<gpx");
    let (decoded, format) = if is_gpx {
        (gpx::parse(bytes), "gpx")
    } else {
        (tcx::parse(bytes), "tcx")
    };
    let activity = decoded.map_err(|reason| {
        IngestError::Storage(format!("the {format} file did not decode: {reason}"))
    })?;
    prepare_activity(key.to_string(), &activity, None, format)
}

fn store_file(
    install: u64,
    name: &str,
    bytes: &[u8],
    progress: &mut Progress,
    batch: &mut Batch,
) -> Result<(), Halt> {
    let key = file_source_key(bytes);
    if holds(&key) {
        progress.already_stored += 1;
        return Ok(());
    }
    // The decode runs before the engine is taken, so the lock is held for the
    // writes alone.
    let prepared = prepare_any(&key, bytes);
    let mut ambiguous = false;
    let stored = write(install, |e| {
        match same_ride(e, &prepared) {
            Existing::One(row) => return link_to_row(e, &row, ORIGIN, bytes),
            Existing::Ambiguous(_) => ambiguous = true,
            Existing::Nothing => {}
        }
        settle(e, &key, Kept::Table { source: ORIGIN }, bytes, prepared)
    })
    .ok_or(Halt::Unstorable)?;
    match stored {
        Ok(Ingested::Stored { tracked }) => {
            progress.stored += 1;
            progress.ambiguous += u32::from(ambiguous);
            batch.keys.push(key);
            batch.tracked += u32::from(tracked);
        }
        Ok(Ingested::AlreadyStored | Ingested::Linked { .. }) => progress.already_stored += 1,
        Err(IngestError::EngineClosed) => return Err(Halt::Unstorable),
        Err(e) => {
            log::warn!("veloqrs: [import] {name} did not store: {e}");
            note_failure(progress, name, Some(key), e.to_string());
        }
    }
    Ok(())
}

/// A fixture's take of the write lock, for the tests that read what a job
/// left in the library.
#[cfg(test)]
fn test_engine<R>(
    install: u64,
    work: impl FnOnce(&mut crate::persistence::PersistentEngine) -> R,
) -> Option<R> {
    crate::persistence::with_persistent_engine_for(install, work)
}

#[cfg(test)]
mod tests;
