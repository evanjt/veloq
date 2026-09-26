#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum VeloqError {
    #[error("Engine not initialised")]
    NotInitialized,
    #[error("Engine lock failed")]
    LockFailed,
    #[error("Database error: {msg}")]
    Database { msg: String },
    #[error("Not found: {msg}")]
    NotFound { msg: String },
    #[error("Parse error: {msg}")]
    ParseError { msg: String },
    #[error("Reference activity: {msg}")]
    ReferenceActivity { msg: String },
    #[error("Basemap tile store: {msg}")]
    TileStore { msg: String },
}

/// Execute a closure with a **write lock** on the persistent engine.
///
/// Use for any mutation, for FFI methods whose closures call through to
/// engine helpers that take `&mut self` (LRU-cache-touching lookups like
/// `get_signature`, `get_group_by_id`, `get_section_by_id`,
/// `get_consensus_route`, `get_section_performances`, `get_groups`), and
/// for any closure that dereferences `self.db` - see the safety invariant
/// on `PERSISTENT_ENGINE`.
///
/// Poison recovery lives in `with_persistent_engine_at`: builds unwind on
/// panic, so a single panic under the write lock would otherwise turn every
/// later FFI call into `LockFailed` for the rest of the session.
#[track_caller]
pub fn with_engine<F, R>(f: F) -> Result<R, VeloqError>
where
    F: FnOnce(&mut crate::persistence::PersistentEngine) -> R,
{
    crate::persistence::with_persistent_engine_at(std::panic::Location::caller(), f)
        .ok_or(VeloqError::NotInitialized)
}

/// Execute a closure against a read-only connection, with **no engine lock**.
///
/// This is the path for a screen read that only needs SQLite. It does not wait
/// for a write in flight, because WAL serves it the last commit instead, and it
/// reaches no engine state at all: the closure gets a `Connection` and nothing
/// else, so the in-memory tier and anything a caller is part-way through
/// writing are both invisible to it. A read that needs either belongs on
/// `with_engine`.
pub fn with_reader<F, R>(f: F) -> Result<R, VeloqError>
where
    F: FnOnce(&rusqlite::Connection) -> R,
{
    crate::persistence::read_pool::with_read_conn(f).ok_or(VeloqError::NotInitialized)
}
