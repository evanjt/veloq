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

/// Execute a closure with the persistent engine, returning a proper error type.
pub fn with_engine<F, R>(f: F) -> Result<R, VeloqError>
where
    F: FnOnce(&mut crate::persistence::PersistentRouteEngine) -> R,
{
    let mut guard = crate::persistence::PERSISTENT_ENGINE
        .lock()
        .map_err(|_| VeloqError::LockFailed)?;
    guard.as_mut().map(f).ok_or(VeloqError::NotInitialized)
}
