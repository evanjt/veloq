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
