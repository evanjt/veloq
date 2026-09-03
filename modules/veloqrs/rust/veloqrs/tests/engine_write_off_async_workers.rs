//! An engine write taken from an async task must not park an async worker.
//!
//! `PERSISTENT_ENGINE` is a blocking `RwLock` and the closures run SQLite, so
//! taking the write lock straight from an `async fn` holds one of the runtime's
//! eight worker threads (`runtime.rs`) for the whole transaction. Enough
//! concurrent writes and nothing else on the runtime is polled, network work
//! included. `with_persistent_engine_blocking` moves the wait to tokio's
//! blocking pool, so the workers stay free.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use tempfile::TempDir;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::{PERSISTENT_ENGINE, with_persistent_engine_blocking};
use veloqrs::runtime;

static SERIAL: Mutex<()> = Mutex::new(());

/// More than the eight workers, so a worker-blocking implementation runs out.
const CONTENDERS: usize = 24;

fn init_engine() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("workers.db");
    assert!(persistent_engine_init(
        db_path.to_str().unwrap().to_string()
    ));
    dir
}

/// Run `body` on its own thread and fail if it has not finished by `deadline`.
/// A worker-blocking implementation does not merely run slowly here, it stops
/// the runtime dead: the timer that would report it needs a worker too. So the
/// deadline has to sit outside the runtime entirely.
fn within<F: FnOnce() + Send + 'static>(deadline: Duration, what: &str, body: F) {
    let (done_tx, done_rx) = mpsc::channel();
    std::thread::spawn(move || {
        body();
        let _ = done_tx.send(());
    });
    assert!(
        done_rx.recv_timeout(deadline).is_ok(),
        "{what} did not finish within {deadline:?}, the async workers are starved"
    );
}

#[test]
fn unrelated_async_work_still_runs_while_engine_writes_are_queued() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = init_engine();

    let progressed = std::sync::Arc::new(AtomicBool::new(false));
    let flag = progressed.clone();

    within(Duration::from_secs(20), "the queued writes", move || {
        runtime::block_on(async move {
            // Hold the write lock from outside the runtime, so every queued engine
            // call has to wait on it. Released by the watchdog below.
            let held = PERSISTENT_ENGINE.write().unwrap_or_else(|e| e.into_inner());

            let mut writes = Vec::new();
            for _ in 0..CONTENDERS {
                writes.push(runtime::spawn(async {
                    with_persistent_engine_blocking(|engine| {
                        let _ = engine.set_setting("b26-probe", "1");
                    })
                    .await
                }));
            }

            // The point of the test: this task is scheduled after all the writes,
            // and must still be polled while they are stuck on the lock.
            let ticker = runtime::spawn(async move {
                flag.store(true, Ordering::SeqCst);
            });

            tokio::time::timeout(Duration::from_secs(5), ticker)
                .await
                .expect("an unrelated task must still be polled while engine writes wait")
                .expect("ticker task");

            drop(held);
            for write in writes {
                let _ = write.await;
            }
        });
    });

    assert!(
        progressed.load(Ordering::SeqCst),
        "the runtime kept making progress"
    );
}

#[test]
fn every_queued_engine_write_lands() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = init_engine();

    let (total_tx, total_rx) = mpsc::channel();
    within(Duration::from_secs(20), "every queued write", move || {
        let total = runtime::block_on(async {
            let mut writes = Vec::new();
            for i in 0..CONTENDERS {
                writes.push(runtime::spawn(async move {
                    with_persistent_engine_blocking(move |engine| {
                        engine.set_setting("b26-counter", &i.to_string()).is_ok()
                    })
                    .await
                }));
            }
            let mut landed = 0;
            for write in writes {
                if write.await.ok().flatten().unwrap_or(false) {
                    landed += 1;
                }
            }
            landed
        });
        let _ = total_tx.send(total);
    });

    let total = total_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("a count");
    assert_eq!(
        total, CONTENDERS,
        "moving the wait off the workers must not drop writes"
    );
}
