//! Scenario: the app leaves the foreground while a write transaction is open
//! on the library, which on iOS sits in the shared App Group container.
//!
//! Expected behaviour: `prepare_for_suspension` returns only once that
//! transaction has committed or rolled back, so no SQLite lock is held when the
//! process is suspended. A write asked for afterwards from a caller's thread is
//! refused at once, without waiting on the engine lock, one from the engine's
//! own workers waits for the resume and then lands, and `resume_after_suspension`
//! restores writes for everyone.

use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use rusqlite::Connection;

use super::{
    begin_write, entered_background, is_suspended, prepare_for_suspension, resume_after_suspension,
    write_or_defer,
};
use crate::objects::error::{VeloqError, with_engine};
use crate::persistence::sections::conditioning::detection_suspended;
use crate::persistence::{PERSISTENT_ENGINE, with_persistent_engine};
use crate::test_globals::{init_global_engine, serial_global_state};

/// Far longer than any step here takes, so only a wait that never ends fails it.
const CEILING: Duration = Duration::from_secs(10);

/// A deadline no test reaches, for a wait only something else may end.
const UNREACHED: Duration = Duration::from_secs(3600);

/// Wait for a suspension started on another thread to take effect.
fn wait_until_suspended() {
    let give_up = Instant::now() + CEILING;
    while !is_suspended() {
        assert!(Instant::now() < give_up, "the suspension never took effect");
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// Whether another connection can take the write lock at once, which it cannot
/// while any connection holds a write transaction open.
fn write_lock_is_free(path: &Path) -> bool {
    let other = Connection::open(path).expect("a second connection");
    other.busy_timeout(Duration::ZERO).expect("busy timeout");
    other.execute_batch("BEGIN IMMEDIATE; ROLLBACK").is_ok()
}

fn stored_setting(path: &Path, key: &str) -> Option<String> {
    let conn = Connection::open(path).expect("a reading connection");
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .ok()
}

/// Open a write transaction under the engine lock on a thread of its own, and
/// hold it until the returned sender is used.
fn hold_a_write_transaction(key: &'static str) -> (mpsc::Sender<()>, std::thread::JoinHandle<()>) {
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let writer = std::thread::spawn(move || {
        with_persistent_engine(|engine| {
            engine.db.execute_batch("BEGIN IMMEDIATE").unwrap();
            engine.set_setting(key, "held").unwrap();
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            engine.db.execute_batch("COMMIT").unwrap();
        })
        .expect("the engine is open");
    });
    entered_rx
        .recv_timeout(CEILING)
        .expect("the writer opened its transaction");
    (release_tx, writer)
}

#[test]
fn suspension_waits_for_the_open_write_transaction_to_end() {
    let _guard = serial_global_state();
    let tmp = init_global_engine("suspension-wait.db");
    let path = tmp.path().join("suspension-wait.db");
    entered_background();

    let (release, writer) = hold_a_write_transaction("before_suspension");
    assert!(
        !write_lock_is_free(&path),
        "test premise: the writer holds a write transaction"
    );

    let held_for = Duration::from_millis(300);
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(held_for);
        release.send(()).unwrap();
    });
    let started = Instant::now();
    let quiet = prepare_for_suspension(CEILING);
    let waited = started.elapsed();

    assert!(quiet, "the engine reports quiet once the write has ended");
    assert!(
        waited >= held_for,
        "returned after {waited:?}, before the {held_for:?} write had committed"
    );
    assert!(
        write_lock_is_free(&path),
        "no write transaction is left open on the library"
    );
    assert_eq!(
        stored_setting(&path, "before_suspension").as_deref(),
        Some("held"),
        "the write in flight commits rather than being lost"
    );

    releaser.join().unwrap();
    writer.join().unwrap();
    resume_after_suspension();
}

#[test]
fn a_write_from_a_caller_after_suspension_is_refused_without_waiting_for_the_lock() {
    let _guard = serial_global_state();
    let tmp = init_global_engine("suspension-refuse.db");
    let path = tmp.path().join("suspension-refuse.db");
    entered_background();
    assert!(prepare_for_suspension(CEILING));
    assert!(is_suspended());

    // The engine lock is held elsewhere, so a write that tried to take it would
    // wait for as long as this test holds it.
    let held = PERSISTENT_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
    let (done_tx, done_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let outcome = with_engine(|engine| engine.set_setting("after_suspension", "written"));
        done_tx.send(outcome.map(|_| ())).unwrap();
    });
    // The lock is let go only once the write has answered, so a write that
    // waited for it never answers.
    let outcome = done_rx.recv_timeout(CEILING);
    drop(held);

    match outcome {
        Ok(Err(VeloqError::Suspended)) => {}
        Ok(other) => panic!("expected the suspended refusal, got {other:?}"),
        Err(_) => panic!("the write waited on the engine lock instead of being refused"),
    }
    assert_eq!(stored_setting(&path, "after_suspension"), None);

    resume_after_suspension();
    assert!(!is_suspended());
    with_engine(|engine| engine.set_setting("after_resume", "written").unwrap())
        .expect("a resumed engine takes writes");
    assert_eq!(
        stored_setting(&path, "after_resume").as_deref(),
        Some("written")
    );
}

#[test]
fn a_worker_write_waits_for_the_resume_and_then_lands() {
    let _guard = serial_global_state();
    let tmp = init_global_engine("suspension-worker.db");
    let path = tmp.path().join("suspension-worker.db");
    entered_background();
    assert!(prepare_for_suspension(CEILING));

    let (done_tx, done_rx) = mpsc::channel();
    let worker = crate::threads::spawn_named("veloq-test-wr", move || {
        let written = with_persistent_engine(|engine| {
            engine.set_setting("worker_write", "landed").unwrap();
        });
        done_tx.send(written.is_some()).unwrap();
    });

    assert!(
        done_rx.recv_timeout(Duration::from_millis(300)).is_err(),
        "a worker's write does not run while the engine is suspended"
    );
    assert_eq!(stored_setting(&path, "worker_write"), None);
    assert!(
        write_lock_is_free(&path),
        "a waiting worker holds no write transaction"
    );

    resume_after_suspension();
    assert_eq!(done_rx.recv_timeout(CEILING), Ok(true));
    worker.join().unwrap();
    assert_eq!(
        stored_setting(&path, "worker_write").as_deref(),
        Some("landed")
    );
}

#[test]
fn a_resume_during_the_wait_ends_it_and_keeps_writes_open() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-overtaken.db");
    entered_background();

    // The writer lets go only after the wait has ended, and the wait's own
    // deadline is out of reach, so only the resume can end it.
    let (release, writer) = hold_a_write_transaction("overtaken");
    let (quiet_tx, quiet_rx) = mpsc::channel();
    std::thread::spawn(move || {
        quiet_tx.send(prepare_for_suspension(UNREACHED)).unwrap();
    });
    wait_until_suspended();

    resume_after_suspension();
    assert_eq!(
        quiet_rx.recv_timeout(CEILING),
        Ok(false),
        "a suspension the resume overtook ends and reports not quiet"
    );
    assert!(!is_suspended());

    release.send(()).unwrap();
    writer.join().unwrap();
    with_engine(|engine| engine.set_setting("after_overtake", "written").unwrap())
        .expect("writes stay open after the resume");
}

#[test]
fn the_deadline_bounds_the_wait_and_the_suspension_holds() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-deadline.db");
    entered_background();

    // The writer lets go only after the wait has ended, so only the deadline
    // can end it.
    let (release, writer) = hold_a_write_transaction("outlasting");
    let deadline = Duration::from_millis(200);
    let (quiet_tx, quiet_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let started = Instant::now();
        let quiet = prepare_for_suspension(deadline);
        quiet_tx.send((quiet, started.elapsed())).unwrap();
    });
    let (quiet, waited) = quiet_rx
        .recv_timeout(CEILING)
        .expect("the deadline ends the wait");

    assert!(!quiet, "a write still open at the deadline is not quiet");
    assert!(waited >= deadline);
    assert!(
        is_suspended(),
        "new writes stay refused even when the wait ran out"
    );

    release.send(()).unwrap();
    writer.join().unwrap();
    resume_after_suspension();
}

#[test]
fn nothing_suspends_while_the_app_is_in_the_foreground() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-foreground.db");
    resume_after_suspension();

    assert!(
        !prepare_for_suspension(CEILING),
        "a suspension asked for after the app came back is refused"
    );
    assert!(!is_suspended());
    with_engine(|engine| engine.set_setting("foreground", "written").unwrap())
        .expect("writes stay open in the foreground");
}

#[test]
fn suspension_holds_detection_and_the_resume_releases_it() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-detection.db");
    assert!(!detection_suspended());

    entered_background();
    assert!(prepare_for_suspension(CEILING));
    assert!(
        detection_suspended(),
        "no detection run starts while suspended"
    );

    // A second ask while suspended takes nothing further.
    assert!(prepare_for_suspension(CEILING));
    resume_after_suspension();
    assert!(!detection_suspended());
}

#[test]
fn a_hold_taken_inside_a_write_neither_waits_nor_is_refused() {
    let _guard = serial_global_state();
    let tmp = init_global_engine("suspension-nested.db");
    let path = tmp.path().join("suspension-nested.db");
    entered_background();

    let (inside_tx, inside_rx) = mpsc::channel();
    let (go_tx, go_rx) = mpsc::channel::<()>();
    let writer = std::thread::spawn(move || {
        let outer = begin_write().expect("the engine is not suspended yet");
        inside_tx.send(()).unwrap();
        go_rx.recv().unwrap();
        // The suspension is set by now. This write belongs to the one in
        // flight, which the suspension is waiting on, so it goes through.
        let inner = with_persistent_engine(|engine| {
            engine.set_setting("nested", "written").unwrap();
        });
        drop(outer);
        inner.is_some()
    });
    inside_rx.recv_timeout(CEILING).unwrap();

    let (quiet_tx, quiet_rx) = mpsc::channel();
    std::thread::spawn(move || quiet_tx.send(prepare_for_suspension(CEILING)).unwrap());
    wait_until_suspended();
    go_tx.send(()).unwrap();

    assert!(writer.join().unwrap(), "the nested write ran");
    assert_eq!(quiet_rx.recv_timeout(CEILING), Ok(true));
    assert_eq!(stored_setting(&path, "nested").as_deref(), Some("written"));
    resume_after_suspension();
}

#[test]
fn a_write_on_a_worker_connection_is_gated_like_the_engine_lock() {
    let _guard = serial_global_state();
    let tmp = init_global_engine("suspension-worker-conn.db");
    let path = tmp.path().join("suspension-worker-conn.db");
    let install = crate::persistence::engine_install();
    entered_background();
    assert!(prepare_for_suspension(CEILING));

    let conn = Connection::open(&path).unwrap();
    let mut ran = false;
    let refused = crate::persistence::sections::detection::worker_write(&conn, install, || {
        ran = true;
        Ok(())
    });
    assert!(refused.is_err(), "a caller's worker write is refused");
    assert!(!ran, "the refused write runs nothing");
    assert!(conn.is_autocommit(), "and opens no transaction");

    let (done_tx, done_rx) = mpsc::channel();
    let worker_path = path.clone();
    let worker = crate::threads::spawn_named("veloq-test-wc", move || {
        let conn = Connection::open(&worker_path).unwrap();
        let written = crate::persistence::sections::detection::worker_write(&conn, install, || {
            conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('worker_conn', 'landed', 0)",
                [],
            )
            .map(|_| ())
        });
        done_tx.send(written.is_ok()).unwrap();
    });
    assert!(
        done_rx.recv_timeout(Duration::from_millis(300)).is_err(),
        "an engine worker's write waits for the resume"
    );

    resume_after_suspension();
    assert_eq!(done_rx.recv_timeout(CEILING), Ok(true));
    worker.join().unwrap();
    assert_eq!(
        stored_setting(&path, "worker_conn").as_deref(),
        Some("landed")
    );
}

/// A write that answers whether it landed, counting its tries and sending
/// each answer, so a test sees both how often it ran and whether it landed.
fn counted_write(
    lands: impl Fn() -> bool + Send + 'static,
) -> (
    std::sync::Arc<std::sync::atomic::AtomicUsize>,
    mpsc::Receiver<bool>,
    impl FnMut() -> bool + Send + 'static,
) {
    let tries = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (tx, rx) = mpsc::channel();
    let counted = tries.clone();
    let write = move || {
        counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let landed = lands();
        let _ = tx.send(landed);
        landed
    };
    (tries, rx, write)
}

#[test]
fn a_write_a_suspension_refuses_lands_at_the_resume() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-deferred.db");
    entered_background();
    assert!(prepare_for_suspension(CEILING));

    let (tries, landed, write) = counted_write(|| with_persistent_engine(|_| ()).is_some());
    write_or_defer(write);
    assert_eq!(landed.recv_timeout(CEILING), Ok(false));
    assert!(
        landed.recv_timeout(Duration::from_millis(300)).is_err(),
        "a refused write is kept, not retried while the engine is suspended"
    );

    resume_after_suspension();
    assert_eq!(
        landed.recv_timeout(CEILING),
        Ok(true),
        "the resume runs the kept write"
    );
    assert_eq!(tries.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[test]
fn a_write_refused_for_another_reason_is_dropped() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-dropped.db");

    let (tries, landed, write) = counted_write(|| false);
    write_or_defer(write);
    assert_eq!(landed.recv_timeout(CEILING), Ok(false));
    assert_eq!(
        tries.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "a write no suspension refused is not asked again"
    );

    // A later suspension and resume does not bring it back.
    entered_background();
    assert!(prepare_for_suspension(CEILING));
    resume_after_suspension();
    assert!(landed.recv_timeout(Duration::from_millis(300)).is_err());
    assert_eq!(tries.load(std::sync::atomic::Ordering::SeqCst), 1);
}
