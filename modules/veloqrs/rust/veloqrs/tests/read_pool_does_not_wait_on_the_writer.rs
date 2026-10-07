//! A screen read must not wait behind a write.
//!
//! Scenario: a sync page commits while the athlete drags the feed. Expected
//! behaviour: a read that only needs SQLite is served while the writer still
//! holds the engine, because it comes through the read pool and takes no
//! engine lock at all. The writer lets go only when the read has returned, so
//! a read that waited for it would never finish before the writer's hang
//! guard ran out, whatever the load on the machine.

use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use tempfile::TempDir;
use veloqrs::objects::error::with_reader;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// How long the writer holds the engine when nothing releases it. It is a hang
/// guard and the only deadline: the read is never timed.
const WRITER_HOLD_LIMIT: Duration = Duration::from_secs(30);

const ROUTE_ID: &str = "r1";
const ROUTE_NAME: &str = "Col du Sanetsch";

/// The engine and the pool are process-wide, so these run one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

fn init_global_engine(name: &str) -> TempDir {
    let tmp = TempDir::new().expect("tempdir");
    let db_path = tmp.path().join(name);
    assert!(
        persistent_engine_init(db_path.to_string_lossy().into_owned()),
        "the fixture database must open"
    );
    tmp
}

/// Write one row, then hold the engine write lock until `release` is sent or
/// `WRITER_HOLD_LIMIT` runs out, which is a sync page as a reader experiences
/// it. Returns once the lock is held and the row is committed, with the
/// writer's handle, which yields whether it was released.
fn writer_holding_the_engine(release: mpsc::Receiver<()>) -> std::thread::JoinHandle<Option<bool>> {
    let (held_tx, held_rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        with_persistent_engine(|engine| {
            engine
                .set_route_name(ROUTE_ID, Some(ROUTE_NAME))
                .expect("write");
            held_tx.send(()).expect("signal the hold");
            release.recv_timeout(WRITER_HOLD_LIMIT).is_ok()
        })
    });
    held_rx.recv().expect("the writer took the engine");
    handle
}

fn route_names_through_the_pool() -> i64 {
    with_reader(|conn| {
        conn.query_row("SELECT COUNT(*) FROM route_names", [], |row| row.get(0))
            .expect("count")
    })
    .expect("the pool is bound once the engine is initialised")
}

#[test]
fn a_pooled_read_is_served_while_a_writer_holds_the_engine() {
    let _serial_state = crate::serial_state();
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = init_global_engine("pooled_read.db");
    let (release, released) = mpsc::channel();
    let writer = writer_holding_the_engine(released);

    let names = route_names_through_the_pool();
    release.send(()).expect("release the writer");

    assert_eq!(
        writer.join().expect("writer"),
        Some(true),
        "the pooled read waited for the writer, which held the engine until it gave up after {WRITER_HOLD_LIMIT:?}"
    );
    assert_eq!(
        names, 1,
        "the reader must see the row the writer committed before it went on holding"
    );
}

#[test]
fn a_pooled_connection_cannot_write() {
    let _serial_state = crate::serial_state();
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = init_global_engine("pooled_readonly.db");

    let refused = with_reader(|conn| {
        conn.execute(
            "INSERT INTO route_names (route_id, custom_name) VALUES ('r2', 'Nope')",
            [],
        )
    })
    .expect("pool");

    assert!(
        refused.is_err(),
        "the pool hands out read-only connections, so a write on one fails at the \
         statement rather than reaching the database"
    );
}
