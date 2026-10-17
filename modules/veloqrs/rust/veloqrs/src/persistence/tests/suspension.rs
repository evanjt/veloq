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

/// Tracks long enough that writing the archive takes far longer than the
/// suspension takes to land, so the export is mid-run when it does.
const EXPORT_TRACKS: usize = 200;
const EXPORT_TRACK_POINTS: usize = 2_000;

fn export_track(seed: usize) -> Vec<crate::GpsPoint> {
    (0..EXPORT_TRACK_POINTS)
        .map(|i| {
            crate::GpsPoint::new(
                46.0 + seed as f64 * 0.001 + i as f64 * 0.000_01,
                7.0 + (i as f64 * 0.37).sin() * 0.001,
            )
        })
        .collect()
}

/// Every entry of an archive, by name.
fn archive_entries(path: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    (0..archive.len())
        .map(|i| {
            let mut entry = archive.by_index(i).unwrap();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            (entry.name().to_string(), without_export_time(bytes))
        })
        .collect()
}

/// An archive's bytes with each export time stamped into it blanked, since two
/// exports of one library differ in the second they were made and nothing else.
fn without_export_time(mut bytes: Vec<u8>) -> Vec<u8> {
    const SHAPE: &[u8] = b"dddd-dd-ddTdd:dd:ddZ";
    let mut i = 0;
    while i + SHAPE.len() <= bytes.len() {
        let window = &bytes[i..i + SHAPE.len()];
        let stamped = window.iter().zip(SHAPE).all(|(&byte, &shape)| match shape {
            b'd' => byte.is_ascii_digit(),
            other => byte == other,
        });
        if stamped {
            bytes[i..i + SHAPE.len()].fill(b'0');
            i += SHAPE.len();
        } else {
            i += 1;
        }
    }
    bytes
}

/// Whether some connection holds a read mark on the write-ahead log, asked
/// without waiting so a held mark answers busy rather than being waited out.
fn a_reader_holds_the_log(path: &Path) -> bool {
    let probe = Connection::open(path).expect("a probing connection");
    probe.busy_timeout(Duration::ZERO).expect("busy timeout");
    let busy: i64 = probe
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
        .expect("checkpoint");
    busy != 0
}

fn wait_for_visited(
    progress: &crate::persistence::export::BulkExportProgress,
    at_least: u32,
) -> u32 {
    let give_up = Instant::now() + CEILING;
    loop {
        let (visited, _) = progress.read();
        if visited >= at_least {
            return visited;
        }
        assert!(
            Instant::now() < give_up,
            "the export never reached {at_least}"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn suspension_pauses_a_bulk_export_with_no_read_left_open() {
    use crate::persistence::export::BulkExportFormat;

    let _guard = serial_global_state();
    // The library is an engine of the test's own. The resume conditions the
    // process-wide engine, which is left empty so no detection run follows.
    let _global = init_global_engine("suspension-export-global.db");
    let tmp = tempfile::TempDir::new().unwrap();
    let path = tmp.path().join("suspension-export.db");
    let mut engine = crate::PersistentEngine::new(path.to_str().unwrap()).unwrap();
    for i in 0..EXPORT_TRACKS {
        engine
            .add_activity(format!("trail-{i:03}"), export_track(i), "Hike".into())
            .unwrap();
    }
    // Leave a frame in the log, so the export reads through it and holds a
    // mark there for as long as its read lasts.
    assert!(
        !a_reader_holds_the_log(&path),
        "test premise: no reader yet"
    );
    Connection::open(&path)
        .unwrap()
        .execute_batch("CREATE TABLE log_frame (id INTEGER)")
        .unwrap();

    let interrupted = tmp.path().join("interrupted.zip");
    let handle = engine.bulk_export_background(
        BulkExportFormat::Gpx,
        interrupted.to_str().unwrap(),
        Default::default(),
    );
    let progress = handle.progress_handle();
    wait_for_visited(&progress, 20);

    entered_background();
    assert!(
        prepare_for_suspension(Duration::from_secs(5)),
        "the export lets go of its read for the suspension"
    );
    assert!(
        !a_reader_holds_the_log(&path),
        "no read is left open on the library while suspended"
    );
    let (paused_at, _) = progress.read();
    assert!(
        (paused_at as usize) < EXPORT_TRACKS,
        "test premise: the export is mid-run when suspended, at {paused_at}"
    );
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        progress.read().0,
        paused_at,
        "the export does not go on while suspended"
    );

    resume_after_suspension();
    let result = handle
        .recv_blocking()
        .expect("the export answers")
        .expect("the export completes");
    assert_eq!(progress.read().0 as usize, EXPORT_TRACKS);
    assert_eq!(result.exported as usize, EXPORT_TRACKS);

    let whole = tmp.path().join("whole.zip");
    engine
        .bulk_export_gpx(whole.to_str().unwrap())
        .expect("an uninterrupted export");
    assert_eq!(
        archive_entries(&interrupted),
        archive_entries(&whole),
        "the paused export writes the archive an uninterrupted one does"
    );
}

#[test]
fn suspension_waits_for_a_read_in_flight_and_holds_back_the_next() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-read.db");
    entered_background();

    let (inside_tx, inside_rx) = mpsc::channel();
    let (go_tx, go_rx) = mpsc::channel::<()>();
    let (second_tx, second_rx) = mpsc::channel();
    let reader = crate::threads::spawn_named("veloq-test-read", move || {
        let first = super::begin_read().expect("the engine is not suspended yet");
        inside_tx.send(()).unwrap();
        go_rx.recv().unwrap();
        drop(first);
        // An engine thread asking again while suspended waits for the resume.
        let second = super::begin_read();
        second_tx.send(second.is_some()).unwrap();
    });
    inside_rx.recv_timeout(CEILING).unwrap();

    let (quiet_tx, quiet_rx) = mpsc::channel();
    std::thread::spawn(move || quiet_tx.send(prepare_for_suspension(CEILING)).unwrap());
    wait_until_suspended();
    assert!(
        quiet_rx.recv_timeout(Duration::from_millis(200)).is_err(),
        "the suspension waits while a read is in flight"
    );
    go_tx.send(()).unwrap();
    assert_eq!(quiet_rx.recv_timeout(CEILING), Ok(true));
    assert!(
        second_rx.recv_timeout(Duration::from_millis(200)).is_err(),
        "a read asked for while suspended does not start"
    );

    resume_after_suspension();
    assert_eq!(second_rx.recv_timeout(CEILING), Ok(true));
    reader.join().unwrap();
}

#[test]
fn a_read_from_a_caller_while_suspended_is_refused() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("suspension-read-refuse.db");
    entered_background();
    assert!(prepare_for_suspension(CEILING));

    let refused = std::thread::spawn(|| super::begin_read().is_none())
        .join()
        .unwrap();
    assert!(
        refused,
        "a caller's thread is never parked on the suspension"
    );
    resume_after_suspension();
}
