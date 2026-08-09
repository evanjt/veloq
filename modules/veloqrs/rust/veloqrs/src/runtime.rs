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

    use tokio::sync::{mpsc, oneshot};

    /// The service-loop property: a task spawned outside any `block_on` is
    /// still alive and reachable from a later, independent `block_on`. A
    /// per-call runtime would drop the pool at the end of `spawn`, cancelling
    /// the loop and leaving the reply channel closed.
    #[test]
    fn spawned_work_survives_between_independent_block_on_calls() {
        let (tx, mut rx) = mpsc::unbounded_channel::<oneshot::Sender<String>>();

        spawn(async move {
            while let Some(reply) = rx.recv().await {
                let name = std::thread::current()
                    .name()
                    .unwrap_or_default()
                    .to_string();
                let _ = reply.send(name);
            }
        });

        let worker_name = block_on(async {
            let (reply_tx, reply_rx) = oneshot::channel();
            tx.send(reply_tx).expect("service loop must still be alive");
            reply_rx
                .await
                .expect("service loop must answer, not have been dropped")
        });

        assert_eq!(
            worker_name, "veloq-net",
            "spawned work must land on the named shared pool"
        );
    }

    /// `block_on` returns the future's own output rather than a default, and
    /// nested `spawn` handles join back into the same call.
    #[test]
    fn block_on_returns_the_joined_output_of_spawned_tasks() {
        let out = block_on(async {
            let a = spawn(async { "left".to_string() });
            let b = spawn(async { "right".to_string() });
            format!("{}-{}", a.await.unwrap(), b.await.unwrap())
        });
        assert_eq!(out, "left-right");
    }
}
