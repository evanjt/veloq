//! Opening the library off the JavaScript thread.
//!
//! `VeloqEngine::create` opens synchronously, which is right for a library
//! already on the current schema (a cold open measured 100 to 140 ms on the
//! test handset). A library from an older release runs the pre-upgrade copy,
//! the migration chain, the repair hooks and the indicator recompute inside
//! that same call, and on a desktop release build with synthetic libraries
//! that measured 1.6 s at 5,000 activities and 5.1 s at 10,000. Past the
//! launch budget the open moves to a thread of its own, the shape of the
//! detector cutover: a start verdict, a progress read polled on a timer, and a
//! terminal state that names how the open ended.

use std::sync::Mutex;

use crate::objects::init::FfiInitOutcome;
use crate::objects::start::FfiStartOutcome;

/// Where the off-thread open stands.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiOpenPhase {
    /// No open has been started in this process.
    Idle = 1,
    /// The open thread holds the file.
    Running = 2,
    /// The open ended. `outcome` says how.
    Finished = 3,
}

/// What a poll of the off-thread open reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct FfiOpenProgress {
    pub phase: FfiOpenPhase,
    /// How the open ended. Present only once `phase` is `Finished`.
    pub outcome: Option<FfiInitOutcome>,
    /// The schema version the file carried when the open started, or nothing
    /// for a file that did not exist yet.
    pub from_schema: Option<u32>,
    /// The schema version this build opens to.
    pub to_schema: u32,
    /// The schema version the file carries now. Present only for a `Finished`
    /// open that left an engine running.
    pub schema_version: Option<u32>,
}

static STATE: Mutex<FfiOpenProgress> = Mutex::new(FfiOpenProgress {
    phase: FfiOpenPhase::Idle,
    outcome: None,
    from_schema: None,
    to_schema: super::schema::SUPPORTED_SCHEMA_VERSION as u32,
    schema_version: None,
});

fn state() -> std::sync::MutexGuard<'static, FfiOpenProgress> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Where the off-thread open stands.
pub fn open_progress() -> FfiOpenProgress {
    *state()
}

/// The schema version stamped in a database's header, read from the file
/// without opening a connection, or nothing when the file is absent or too
/// short to carry one.
///
/// `user_version` is a big-endian word at byte 60 of the first page. Under WAL
/// a committed upgrade can still sit in the log, so the main file can read
/// older than the library is. That errs towards the off-thread open, which
/// costs a thread hop and never a stall.
pub fn header_schema_version(db_path: &str) -> Option<u32> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(db_path).ok()?;
    let mut word = [0u8; 4];
    file.seek(SeekFrom::Start(60)).ok()?;
    file.read_exact(&mut word).ok()?;
    Some(u32::from_be_bytes(word))
}

/// Whether opening `db_path` has an upgrade to run. A file that is absent or
/// empty is a fresh library and opens in the time a new one always does.
pub fn upgrade_pending(db_path: &str) -> bool {
    header_schema_version(db_path).is_some_and(|version| {
        version > 0 && version < super::schema::SUPPORTED_SCHEMA_VERSION as u32
    })
}

/// Open the file and say how that ended. The owner reopen flag is set: this is
/// the foreground launch, and only a push handler is ever refused.
fn open_to_outcome(db_path: String) -> FfiInitOutcome {
    match crate::persistence::persistent_engine_ffi::open_if_closed(db_path, true) {
        Some(true) => {
            crate::persistence::sections::conditioning::condition_pending();
            FfiInitOutcome::Opened
        }
        Some(false) => FfiInitOutcome::Opened,
        None => crate::persistence::persistent_engine_ffi::last_init_outcome(),
    }
}

/// Open the library on a thread of its own and answer at once, or answer
/// `NotOwed` when the file has no upgrade to run.
pub fn start_open(db_path: String) -> FfiStartOutcome {
    if !upgrade_pending(&db_path) {
        return FfiStartOutcome::NotOwed;
    }
    let from_schema = header_schema_version(&db_path).filter(|version| *version > 0);
    {
        let mut held = state();
        if held.phase == FfiOpenPhase::Running {
            return FfiStartOutcome::Busy;
        }
        *held = FfiOpenProgress {
            phase: FfiOpenPhase::Running,
            outcome: None,
            from_schema,
            to_schema: super::schema::SUPPORTED_SCHEMA_VERSION as u32,
            schema_version: None,
        };
    }
    crate::threads::spawn_named("veloq-open", move || {
        // A panic in the open must still end the state: a poller that never
        // sees `Finished` waits out its deadline for nothing.
        let outcome =
            std::panic::catch_unwind(|| open_to_outcome(db_path)).unwrap_or(FfiInitOutcome::Failed);
        finish(outcome);
    });
    FfiStartOutcome::Started
}

fn finish(outcome: FfiInitOutcome) {
    let schema_version = outcome
        .opened()
        .then(|| {
            crate::objects::error::with_reader(|conn| {
                conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
                    .ok()
            })
            .ok()
            .flatten()
        })
        .flatten();
    let mut held = state();
    held.phase = FfiOpenPhase::Finished;
    held.outcome = Some(outcome);
    held.schema_version = schema_version;
}
