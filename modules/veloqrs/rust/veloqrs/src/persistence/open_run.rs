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

/// The schema version `db_path` carries, counting an upgrade committed to the
/// log and not yet checkpointed.
///
/// The header is read first because it is free and is the whole answer for a
/// file with no log. When the log holds frames the header can name a schema the
/// file has already left, which would send a migrated library through the
/// off-thread open again, so SQLite is asked instead. It opens the existing
/// file without creating one, and any failure there falls back to the header.
pub fn schema_version(db_path: &str) -> Option<u32> {
    let header = header_schema_version(db_path)?;
    let wal = format!("{db_path}-wal");
    if std::fs::metadata(wal).map_or(true, |meta| meta.len() == 0) {
        return Some(header);
    }
    let through_the_log = rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .and_then(|conn| {
        conn.busy_timeout(std::time::Duration::from_millis(250))?;
        conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
    });
    Some(through_the_log.unwrap_or(header))
}

/// Whether opening `db_path` has an upgrade to run. A file that is absent or
/// empty is a fresh library and opens in the time a new one always does.
pub fn upgrade_pending(db_path: &str) -> bool {
    schema_version(db_path).is_some_and(|version| {
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
    // A running open answers before the file is read: once its migration has
    // committed the file reads as current, and `NotOwed` would hide the open
    // still repairing it.
    if state().phase == FfiOpenPhase::Running {
        return FfiStartOutcome::Busy;
    }
    if !upgrade_pending(&db_path) {
        return FfiStartOutcome::NotOwed;
    }
    let from_schema = schema_version(&db_path).filter(|version| *version > 0);
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// A file whose upgrade is committed but not yet checkpointed: the main
    /// file's header still names the old schema while the log holds the new
    /// one. The returned connection keeps the log alive.
    fn upgraded_in_the_log(old: u32, new: u32) -> (tempfile::TempDir, String, Connection) {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE t (id INTEGER)").unwrap();
        conn.pragma_update(None, "user_version", old).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.pragma_update(None, "user_version", new).unwrap();
        (dir, path.to_str().unwrap().to_string(), conn)
    }

    #[test]
    fn a_schema_committed_only_to_the_log_owes_no_upgrade() {
        let current = super::super::schema::SUPPORTED_SCHEMA_VERSION as u32;
        let (_dir, db_path, _conn) = upgraded_in_the_log(current - 1, current);
        assert_eq!(header_schema_version(&db_path), Some(current - 1));

        assert_eq!(schema_version(&db_path), Some(current));
        assert!(!upgrade_pending(&db_path));
        assert_eq!(start_open(db_path), FfiStartOutcome::NotOwed);
    }

    #[test]
    fn a_schema_behind_in_the_log_and_the_header_still_owes_an_upgrade() {
        let current = super::super::schema::SUPPORTED_SCHEMA_VERSION as u32;
        let (_dir, db_path, _conn) = upgraded_in_the_log(current - 2, current - 1);

        assert_eq!(schema_version(&db_path), Some(current - 1));
        assert!(upgrade_pending(&db_path));
    }

    #[test]
    fn a_file_with_no_log_reads_its_header() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", 12).unwrap();
            conn.execute_batch("CREATE TABLE t (id INTEGER)").unwrap();
        }
        let db_path = path.to_str().unwrap();
        assert_eq!(schema_version(db_path), Some(12));
        assert_eq!(schema_version("/nonexistent/routes.db"), None);
    }
}
