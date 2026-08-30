//! Durations for the two runs a user waits on at the first launch after an
//! update: the migration chain and the detector cutover.
//!
//! A field report of a slow first load cannot be acted on without them. Both
//! runs are silent about how long they took, so a logcat from the device that
//! saw it cannot tell a slow migration from a slow re-cut, and the only
//! remaining move is to guess. These assertions are about the numbers reaching
//! the log, not about their size: a budget here would be a desktop number
//! standing in for a phone.

mod migration_support;

use log::{Level, Log, Metadata, Record};
use migration_support::seed_at_version;
use std::sync::{Mutex, MutexGuard, OnceLock};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// The cutover is process-global, so two tests driving one would interleave.
static SERIAL: Mutex<()> = Mutex::new(());
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

// ── log capture ────────────────────────────────────────────────────────────

static LINES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

struct Capture;

impl Log for Capture {
    fn enabled(&self, _: &Metadata) -> bool {
        true
    }
    fn log(&self, record: &Record) {
        if record.level() <= Level::Info {
            lines().lock().unwrap().push(record.args().to_string());
        }
    }
    fn flush(&self) {}
}

fn lines() -> &'static Mutex<Vec<String>> {
    LINES.get_or_init(|| Mutex::new(Vec::new()))
}

/// Install the capture once per test binary and clear what earlier tests left.
fn start_capturing() {
    let _ = log::set_boxed_logger(Box::new(Capture));
    log::set_max_level(log::LevelFilter::Info);
    lines().lock().unwrap().clear();
}

fn captured() -> Vec<String> {
    lines().lock().unwrap().clone()
}

/// The one line containing every fragment, or a panic naming what was logged
/// instead. Returning the line lets a caller read the number back out of it.
fn line_with(fragments: &[&str]) -> String {
    let all = captured();
    let hits: Vec<&String> = all
        .iter()
        .filter(|line| fragments.iter().all(|f| line.contains(f)))
        .collect();
    assert_eq!(
        hits.len(),
        1,
        "expected exactly one log line containing {fragments:?}, found {}. Logged:\n{}",
        hits.len(),
        all.join("\n")
    );
    hits[0].clone()
}

/// The integer that follows `label` in `line`, so a test asserts on the number
/// rather than on the wording around it.
fn number_after(line: &str, label: &str) -> u64 {
    let rest = line
        .split_once(label)
        .unwrap_or_else(|| panic!("no {label:?} in {line:?}"))
        .1;
    let digits: String = rest
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits
        .parse()
        .unwrap_or_else(|_| panic!("no number after {label:?} in {line:?}"))
}

// ── the migration chain ────────────────────────────────────────────────────

#[test]
fn the_upgrade_every_live_user_takes_logs_how_long_its_migrations_ran() {
    let _serial = serial();
    start_capturing();

    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    drop(seed_at_version(&path, 12));

    drop(veloqrs::PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine"));

    let line = line_with(&["[Schema]", "Migration complete"]);
    assert!(
        line.contains("from version 12"),
        "the duration is unreadable without the version it started at: {line:?}"
    );
    number_after(&line, "migrations ");
    number_after(&line, "hooks ");
}

/// A launch with nothing to migrate must not report a duration for work it did
/// not do, or every ordinary launch logs a timing that reads as an upgrade.
#[test]
fn a_launch_with_no_migration_owed_logs_no_migration_duration() {
    let _serial = serial();

    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    drop(veloqrs::PersistentRouteEngine::new(path.to_str().unwrap()).expect("first open"));

    start_capturing();
    drop(veloqrs::PersistentRouteEngine::new(path.to_str().unwrap()).expect("second open"));

    let migrated: Vec<String> = captured()
        .into_iter()
        .filter(|l| l.contains("Migration complete"))
        .collect();
    assert!(
        migrated.is_empty(),
        "a launch that migrated nothing still reported a migration: {migrated:?}"
    );
}

// ── the cutover ────────────────────────────────────────────────────────────

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

/// A library whose catalogue an older build cut, the shape every install
/// upgrading from 0.3.x arrives in.
fn seed_older_build_engine(path: &std::path::Path) {
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for i in 0..4 {
            let id = format!("ride_{i}");
            engine
                .add_activity(
                    id.clone(),
                    line_track(f64::from(i) * 0.00002),
                    "Ride".into(),
                )
                .expect("add activity");
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i64::from(i) * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .unwrap();

    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache) = handle.recv_with_cache();
        let (sections, processed) = main.expect("detect");
        engine
            .apply_sections_with_cache(sections, cache)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed)
            .expect("save");
    })
    .unwrap();

    let db = rusqlite::Connection::open(path).expect("open");
    db.execute(
        "DELETE FROM schema_info WHERE key = 'catalogue_detection_method'",
        [],
    )
    .expect("strip the detector marker");

    let sections = with_persistent_engine(|e| e.get_sections().len()).unwrap();
    assert!(
        sections > 0,
        "the seed detect produced no catalogue to cut over"
    );
}

#[test]
fn the_cutover_logs_a_duration_for_every_phase_and_for_the_run() {
    let _serial = serial();

    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    assert!(
        veloqrs::ffi::is_cutover_pending(),
        "the seed owes no cutover"
    );

    start_capturing();
    assert!(veloqrs::ffi::start_detector_cutover(), "cutover refused");
    while veloqrs::ffi::get_cutover_progress().running {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(veloqrs::ffi::get_cutover_progress().phase, "complete");

    // Every phase the user waits through, not only the one that is usually
    // slowest: a report naming the wrong phase is worse than no report.
    for phase in ["draining", "archiving", "detecting", "diffing"] {
        let line = line_with(&["[cutover]", phase, "took"]);
        number_after(&line, "took ");
    }

    let total = line_with(&["[cutover]", "Cutover complete"]);
    number_after(&total, "in ");
}

/// A run that fails partway is the one worth timing most, so the phases it did
/// reach must still report. Detection is suspended under the engine, so the
/// drain never clears and the run gives up inside the draining phase.
#[test]
fn a_cutover_that_fails_still_logs_the_phases_it_reached() {
    let _serial = serial();

    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    start_capturing();
    with_persistent_engine(|e| e.set_setting("__section_config_json", "{".into())).unwrap();
    assert!(veloqrs::ffi::start_detector_cutover(), "cutover refused");
    while veloqrs::ffi::get_cutover_progress().running {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    let line = line_with(&["[cutover]", "draining", "took"]);
    number_after(&line, "took ");
}
