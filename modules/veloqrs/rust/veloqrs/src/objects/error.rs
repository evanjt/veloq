#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum VeloqError {
    #[error("Engine not initialized")]
    NotInitialized,
    #[error("Engine lock failed")]
    LockFailed,
    #[error("Database error: {msg}")]
    Database { msg: String },
    #[error("Not found: {msg}")]
    NotFound { msg: String },
}

/// Execute a closure with a **write lock** on the persistent engine.
///
/// Use for any mutation, for FFI methods whose closures call through to
/// engine helpers that take `&mut self` (LRU-cache-touching lookups like
/// `get_signature`, `get_group_by_id`, `get_section_by_id`,
/// `get_consensus_route`, `get_section_performances`, `get_groups`), and
/// for any closure that dereferences `self.db` — see the safety invariant
/// on `PERSISTENT_ENGINE`.
pub fn with_engine<F, R>(f: F) -> Result<R, VeloqError>
where
    F: FnOnce(&mut crate::persistence::PersistentRouteEngine) -> R,
{
    let mut guard = crate::persistence::PERSISTENT_ENGINE
        .write()
        .map_err(|_| VeloqError::LockFailed)?;
    guard.as_mut().map(f).ok_or(VeloqError::NotInitialized)
}

/// Execute a closure with a **read lock** on the persistent engine.
///
/// Multiple callers can hold the read lock concurrently. The closure
/// receives `&PersistentRouteEngine`, so any call into a `&mut self` helper
/// fails to compile.
///
/// **Safety**: do not call any method that dereferences `self.db` from
/// inside this closure. SQLite access goes through the write lock only.
pub fn with_engine_read<F, R>(f: F) -> Result<R, VeloqError>
where
    F: FnOnce(&crate::persistence::PersistentRouteEngine) -> R,
{
    let guard = crate::persistence::PERSISTENT_ENGINE
        .read()
        .map_err(|_| VeloqError::LockFailed)?;
    guard.as_ref().map(f).ok_or(VeloqError::NotInitialized)
}
