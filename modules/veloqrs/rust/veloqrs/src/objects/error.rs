#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum VeloqError {
    #[error("Engine not initialised")]
    NotInitialized,
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
    /// A job of that kind already holds its slot. Not a failure: the running
    /// one carries on, and a caller shows it as still running.
    #[error("Already running: {msg}")]
    Busy { msg: String },
    /// A rename to a name another section already shows. The athlete picks a
    /// different name, so a caller shows it as a refusal and not a failure.
    #[error("Another section is already named {name}")]
    NameTaken { name: String },
}

/// Execute a closure with a **write lock** on the persistent engine.
///
/// Use for a mutation, and for a read that needs engine memory: the in-memory
/// tiers, the section and match configs, or a lookup that fills an engine LRU.
/// A read that needs only committed SQLite rows goes through [`with_reader`]
/// and a pooled function on a `&Connection`, so it does not wait behind a
/// write in flight.
///
/// Poison recovery lives in `with_persistent_engine_at`: builds unwind on
/// panic, so a single panic under the write lock would otherwise turn every
/// later FFI call into a failure for the rest of the session.
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
