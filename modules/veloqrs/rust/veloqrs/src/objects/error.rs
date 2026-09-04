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

/// Execute a closure with a **read lock** on the persistent engine.
///
/// Multiple callers can hold the read lock concurrently. The closure
/// receives `&PersistentEngine`, so any call into a `&mut self` helper
/// fails to compile.
///
/// **Safety**: do not call any method that dereferences `self.db` from
/// inside this closure. SQLite access goes through the write lock only.
pub fn with_engine_read<F, R>(f: F) -> Result<R, VeloqError>
where
    F: FnOnce(&crate::persistence::PersistentEngine) -> R,
{
    // Same poison recovery as with_engine.
    let guard = crate::persistence::PERSISTENT_ENGINE
        .read()
        .unwrap_or_else(|e| e.into_inner());
    guard.as_ref().map(f).ok_or(VeloqError::NotInitialized)
}
