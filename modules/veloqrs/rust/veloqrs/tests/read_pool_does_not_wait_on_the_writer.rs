//! A screen read must not wait behind a write.
//!
//! Scenario: a sync page commits while the athlete drags the feed. Expected
//! behaviour: a read that only needs SQLite is served inside a frame, because
//! it comes through the read pool and takes no engine lock at all. The same
//! read through the engine's read lock waits for the whole write, which is
//! asserted here too, so the pool is compared against the wait it exists to
//! remove rather than against nothing.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tempfile::TempDir;
use veloqrs::objects::error::with_reader;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// One 60 Hz frame. A read that takes longer than this drops one.
const FRAME_BUDGET: Duration = Duration::from_millis(16);

/// How long the synthetic writer holds the engine. Long enough that a wait on
/// it cannot be read as scheduling noise.
const WRITE_HOLD: Duration = Duration::from_millis(200);

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

/// Write one row and hold the engine write lock for `WRITE_HOLD` afterwards,
/// which is a sync page as a reader experiences it. Returns once the lock is
/// held and the row is committed.
fn writer_holding_the_engine() -> std::thread::JoinHandle<()> {
    let holding = Arc::new(AtomicBool::new(false));
    let signal = Arc::clone(&holding);
    let handle = std::thread::spawn(move || {
        with_persistent_engine(|engine| {
            engine
                .set_route_name(ROUTE_ID, Some(ROUTE_NAME))
                .expect("write");
            signal.store(true, Ordering::SeqCst);
            std::thread::sleep(WRITE_HOLD);
        });
    });
    while !holding.load(Ordering::SeqCst) {
        std::thread::yield_now();
    }
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
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = init_global_engine("pooled_read.db");
    let writer = writer_holding_the_engine();

    let started = Instant::now();
    let names = route_names_through_the_pool();
    let waited = started.elapsed();

    assert_eq!(
        names, 1,
        "the reader must see the row the writer committed before it went to sleep"
    );
    assert!(
        waited < FRAME_BUDGET,
        "a pooled read waited {waited:?}, which is over a frame"
    );

    writer.join().expect("writer");
}

/// The wait the pool removes, measured on the only lock the engine has left.
///
/// This stood on `with_engine_read` until the read lock went: nothing holds a
/// shared `&PersistentEngine` any more, so the comparison the test above makes
/// is against the write lock, which is what every remaining engine caller
/// takes.
#[test]
fn the_engine_lock_is_the_wait_the_pool_removes() {
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let _tmp = init_global_engine("read_lock_wait.db");
    let writer = writer_holding_the_engine();

    let started = Instant::now();
    with_persistent_engine(|_| ()).expect("engine");
    let waited = started.elapsed();

    assert!(
        waited > WRITE_HOLD / 2,
        "the engine lock was served in {waited:?}, so this test no longer measures a \
         reader waiting on a writer and the comparison it stands beside means nothing"
    );

    writer.join().expect("writer");
}

#[test]
fn a_pooled_connection_cannot_write() {
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
