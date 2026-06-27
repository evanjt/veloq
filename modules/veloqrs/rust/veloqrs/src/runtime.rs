//! Shared process-wide async runtime.
//!
//! Every outbound network call used to build its own multi-thread tokio runtime
//! per FFI call (8 worker threads each), then drop it. That is wasteful and means
//! there is no single place to host a long-lived service loop. This module owns
//! one runtime for the whole process; all fetches and the future sync service run
//! on it.

use once_cell::sync::Lazy;
use tokio::runtime::Runtime;

/// One multi-thread tokio runtime for the whole process, built lazily on first
/// use and kept for the process lifetime.
pub static ASYNC_RUNTIME: Lazy<Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(8)
        .thread_name("veloq-net")
        .enable_all()
        .build()
        .expect("failed to build shared tokio runtime")
});

/// Drive a future to completion on the shared runtime, blocking the caller.
///
/// For sync FFI entry points that need a result inline. Must not be called from
/// inside a task already running on `ASYNC_RUNTIME` (tokio forbids nested
/// `block_on`); those should `.await` directly instead.
pub fn block_on<F: std::future::Future>(fut: F) -> F::Output {
    ASYNC_RUNTIME.block_on(fut)
}

/// Spawn a future onto the shared runtime without blocking the caller.
pub fn spawn<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    ASYNC_RUNTIME.spawn(fut)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_on_runs_to_completion() {
        let n = block_on(async { 20 + 22 });
        assert_eq!(n, 42);
    }

    #[test]
    fn spawn_runs_concurrently_and_joins() {
        let out = block_on(async {
            let a = spawn(async { 1 });
            let b = spawn(async { 2 });
            a.await.unwrap() + b.await.unwrap()
        });
        assert_eq!(out, 3);
    }

    #[test]
    fn runtime_is_shared_across_calls() {
        // Two independent block_on calls reuse the same global runtime.
        assert_eq!(block_on(async { 1 }), 1);
        assert_eq!(block_on(async { 2 }), 2);
    }
}
