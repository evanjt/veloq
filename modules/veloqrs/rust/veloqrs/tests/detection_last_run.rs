//! A detection run leaves one row saying when it finished, how many activities
//! it took on and how many sections it formed, re-cut and retired.
//!
//! Scenario: four parallel tracks over one line form a section on the first
//! run; a fifth track is stored and the run repeats.
//!
//! Expected behaviour: the first run reads complete with every activity
//! handled and the formed sections as added, and the second run replaces that
//! row rather than adding another.
//!
//! Run: `cargo test --test detection_global -p veloqrs -- detection_last_run::`

use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::objects::DetectionManager;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn store(index: i32) {
    with_persistent_engine(|engine| {
        let id = format!("ride_{index}");
        engine
            .add_activity(
                id.clone(),
                line_track(f64::from(index) * 0.00002),
                "Ride".into(),
            )
            .expect("add activity");
        engine
            .update_activity_metadata(
                &id,
                Some(1_700_000_000 - i64::from(index) * 14 * 86_400),
                None,
                None,
                None,
            )
            .expect("metadata");
    })
    .expect("engine installed");
}

fn run_to_the_end(detection: &DetectionManager) {
    let deadline = Instant::now() + Duration::from_secs(120);
    while detection.poll().unwrap_or_default() == "running" || detection.last_outcome() == "idle" {
        assert!(Instant::now() < deadline, "the run never ended");
        std::thread::sleep(Duration::from_millis(10));
    }
}

struct Row {
    finished_at: i64,
    outcome: String,
    handled: u32,
    added: u32,
    changed: u32,
    retired: u32,
    failed: u32,
}

fn detection_rows(db: &std::path::Path) -> Vec<Row> {
    let conn = Connection::open(db).expect("open db");
    let mut stmt = conn
        .prepare(
            "SELECT finished_at, outcome, handled, added, changed, retired, failed
             FROM job_runs WHERE job = 'detection'",
        )
        .expect("prepare");
    stmt.query_map([], |r| {
        Ok(Row {
            finished_at: r.get(0)?,
            outcome: r.get(1)?,
            handled: r.get(2)?,
            added: r.get(3)?,
            changed: r.get(4)?,
            retired: r.get(5)?,
            failed: r.get(6)?,
        })
    })
    .expect("query")
    .collect::<Result<_, _>>()
    .expect("rows")
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_finished_run_records_what_it_handled_and_formed() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.min_activities = 3;
        engine.set_section_config(cfg).expect("config");
    })
    .expect("engine installed");
    (0..4).for_each(store);
    assert!(detection_rows(&path).is_empty(), "nothing has run yet");

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start").started());
    run_to_the_end(&detection);

    let mut rows = detection_rows(&path);
    assert_eq!(rows.len(), 1);
    let first = rows.remove(0);
    assert_eq!(first.outcome, "complete");
    assert_eq!(first.handled, 4);
    assert!(first.added >= 1, "the shared line forms a section");
    assert_eq!((first.changed, first.retired, first.failed), (0, 0, 0));
    assert!(first.finished_at > 0);

    store(4);
    assert!(detection.start().expect("second start").started());
    run_to_the_end(&detection);

    let mut rows = detection_rows(&path);
    assert_eq!(rows.len(), 1, "a run replaces the last one");
    let second = rows.remove(0);
    assert!(second.finished_at >= first.finished_at);
    assert_eq!(second.outcome, "complete");
}

/// Not framed postcard, not unframed postcard, not an rmp array header: no
/// container claims it, so the track loader reports the row as unreadable.
const UNDECODABLE: &[u8] = &[0x7f, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];

fn set_blob(db: &std::path::Path, id: &str, blob: &[u8]) {
    let conn = Connection::open(db).expect("open db");
    let n = conn
        .execute(
            "UPDATE gps_tracks SET track_data = ? WHERE activity_id = ?",
            rusqlite::params![blob, id],
        )
        .expect("blob update");
    assert_eq!(n, 1, "expected one gps_tracks row for {id}");
}

fn stored_blob(db: &std::path::Path, id: &str) -> Vec<u8> {
    Connection::open(db)
        .expect("open db")
        .query_row(
            "SELECT track_data FROM gps_tracks WHERE activity_id = ?",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .expect("stored blob")
}

fn seeded(library: i32) -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    (0..library).for_each(store);
    (dir, path)
}

fn only_row(db: &std::path::Path) -> (String, u32, u32) {
    let mut rows = detection_rows(db);
    assert_eq!(rows.len(), 1, "one row per job");
    let row = rows.remove(0);
    (row.outcome, row.handled, row.failed)
}

/// Scenario: a library of twenty with one unreadable row, then the row is
/// repaired and detection runs again.
/// Expected behaviour: the catalogue is cut over the nineteen readable
/// tracks, so the run reads partial with the unreadable count as failed; the
/// repaired library reads complete with none.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_unreadable_track_makes_the_run_partial_until_it_is_repaired() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded(20);
    let good = stored_blob(&path, "ride_3");
    set_blob(&path, "ride_3", UNDECODABLE);

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start").started());
    run_to_the_end(&detection);
    assert_eq!(only_row(&path), ("partial".to_string(), 20, 1));

    set_blob(&path, "ride_3", &good);
    store(20);
    assert!(detection.start().expect("second start").started());
    run_to_the_end(&detection);
    assert_eq!(only_row(&path), ("complete".to_string(), 21, 0));
}

/// Scenario: every row of a library of twelve is unreadable, the shape a
/// codec change takes.
/// Expected behaviour: the run is abandoned and its failed row still says how
/// many rows it met and how many were unreadable.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_abandoned_run_records_the_pool_it_met() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded(12);
    (0..12).for_each(|i| set_blob(&path, &format!("ride_{i}"), UNDECODABLE));

    let detection = DetectionManager::new();
    assert!(detection.start().expect("start").started());
    run_to_the_end(&detection);

    assert_eq!(only_row(&path), ("failed".to_string(), 12, 12));
}
