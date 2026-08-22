//! Cutover: archive, switch, cold detect, diff, restore.
//!
//! Synthetic coordinates only. Run: `cargo test --test cutover -p veloqrs`

use std::sync::{Mutex, MutexGuard};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::sections::DetectionMethod;
use veloqrs::persistence::cutover::CutoverOutcome;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

static SERIAL: Mutex<()> = Mutex::new(());
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seed_corridor_engine(path: &std::path::Path) {
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.detection_method = DetectionMethod::Corridor;
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for i in 0..4 {
            let id = format!("ride_{i}");
            engine
                .add_activity(id.clone(), line_track(i as f64 * 0.00002), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i as i64 * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .unwrap();

    // Run one Corridor detect so we have a catalogue to archive.
    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, processed_ids) = main.expect("detect");
        engine
            .apply_sections_with_cache(sections, cache_update)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed_ids)
            .expect("save");
    })
    .unwrap();
}

#[test]
fn cutover_archives_switches_and_detects() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    let pre_count = with_persistent_engine(|e| e.get_sections().len()).unwrap();
    assert!(pre_count > 0, "the corridor detect produced no sections");

    let pre_method = with_persistent_engine(|e| e.get_section_config().detection_method).unwrap();
    assert_eq!(pre_method, DetectionMethod::Corridor);

    // The cutover should be owed: we are on Corridor and no token exists.
    assert!(veloqrs::ffi::is_cutover_pending());

    let result = veloqrs::persistence::cutover::run_cutover();
    assert!(result.is_ok(), "cutover failed: {:?}", result.err());

    let CutoverOutcome::Completed(diff_json) = result.unwrap() else {
        panic!("the first run should complete, not report not-owed");
    };
    assert!(!diff_json.is_empty(), "diff payload is empty");

    // Config should now be Unified.
    let post_method = with_persistent_engine(|e| e.get_section_config().detection_method).unwrap();
    assert_eq!(post_method, DetectionMethod::Unified);

    // Should no longer be pending.
    assert!(!veloqrs::ffi::is_cutover_pending());

    // A second run is a no-op.
    let second = veloqrs::persistence::cutover::run_cutover().unwrap();
    assert_eq!(second, CutoverOutcome::NotOwed);
}

#[test]
fn cutover_is_idempotent_on_rerun() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    let r1 = veloqrs::persistence::cutover::run_cutover();
    assert!(r1.is_ok());

    let r2 = veloqrs::persistence::cutover::run_cutover().unwrap();
    assert_eq!(r2, CutoverOutcome::NotOwed, "second run should be a no-op");
}

#[test]
fn restore_gives_back_the_old_catalogue_as_pinned() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    let pre_ids: Vec<String> =
        with_persistent_engine(|e| e.get_sections().iter().map(|s| s.id.clone()).collect())
            .unwrap();
    assert!(!pre_ids.is_empty());

    // Member counts before the cutover, to compare after the revert.
    let pre_visits: Vec<(String, u32)> = with_persistent_engine(|e| {
        e.get_sections()
            .iter()
            .map(|s| (s.id.clone(), s.visit_count))
            .collect()
    })
    .unwrap();

    veloqrs::persistence::cutover::run_cutover().unwrap();

    let restored = with_persistent_engine(|e| e.restore_from_archive())
        .unwrap()
        .expect("restore");
    assert!(restored > 0, "nothing was restored");

    let method = with_persistent_engine(|e| e.get_section_config().detection_method).unwrap();
    assert_eq!(method, DetectionMethod::Corridor);

    assert!(!veloqrs::ffi::is_cutover_pending());

    let pinned: Vec<bool> = with_persistent_engine(|e| {
        e.get_sections()
            .iter()
            .filter(|s| pre_ids.contains(&s.id))
            .map(|s| s.is_user_defined)
            .collect()
    })
    .unwrap();
    assert!(
        !pinned.is_empty() && pinned.iter().all(|&p| p),
        "restored sections should be is_user_defined = true"
    );

    // A restored section with no members is geometry with nothing behind it:
    // the card would claim visits the detail screen cannot list.
    let post_visits: Vec<(String, u32)> = with_persistent_engine(|e| {
        e.get_sections()
            .iter()
            .filter(|s| pre_ids.contains(&s.id))
            .map(|s| (s.id.clone(), s.visit_count))
            .collect()
    })
    .unwrap();
    for (id, before) in &pre_visits {
        let after = post_visits.iter().find(|(pid, _)| pid == id);
        assert_eq!(
            after.map(|(_, v)| *v),
            Some(*before),
            "section {id} came back without its members"
        );
    }

    // Only the restored catalogue stands. A leftover Unified row over the same
    // ground would show the user two sections where they had one.
    let leftover = with_persistent_engine(|e| {
        e.get_sections()
            .iter()
            .filter(|s| !pre_ids.contains(&s.id))
            .count()
    })
    .unwrap();
    assert_eq!(leftover, 0, "Unified sections survived the revert");
}

/// A user whose catalogue is entirely pinned archives nothing. Revert must
/// still take them back to Corridor rather than silently doing nothing.
#[test]
fn revert_rolls_back_the_config_even_with_an_empty_archive() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.detection_method = DetectionMethod::Corridor;
        engine.set_section_config(cfg);
    })
    .unwrap();

    veloqrs::persistence::cutover::run_cutover().expect("cutover over an empty library");

    let restored = with_persistent_engine(|e| e.restore_from_archive())
        .unwrap()
        .expect("restore");
    assert_eq!(restored, 0, "an empty archive restores nothing");

    let method = with_persistent_engine(|e| e.get_section_config().detection_method).unwrap();
    assert_eq!(
        method,
        DetectionMethod::Corridor,
        "revert must roll the config back even when the archive is empty"
    );
    assert!(!veloqrs::ffi::is_cutover_pending());
}

/// A run that dies after the switch leaves the token in flight. The config
/// already reads Unified, so only the token can say the migration is unfinished.
#[test]
fn an_interrupted_run_is_still_owed() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    // Stand in for a process that died between the switch and the diff.
    with_persistent_engine(|e| {
        e.set_setting("__detector_cutover", "unified-1-inflight")
            .expect("write in-flight token");
        let mut cfg = e.get_section_config();
        cfg.detection_method = DetectionMethod::Unified;
        e.set_section_config(cfg);
    })
    .unwrap();

    let owed = with_persistent_engine(|e| e.cutover_is_owed()).unwrap();
    assert!(
        owed,
        "an in-flight token is owed even though the config already says Unified"
    );

    veloqrs::persistence::cutover::run_cutover().expect("resumed cutover");
    assert!(!veloqrs::ffi::is_cutover_pending());
}

#[test]
fn diff_payload_is_retrievable_after_restart() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    veloqrs::persistence::cutover::run_cutover().unwrap();

    let diff = veloqrs::ffi::get_cutover_diff();
    assert!(diff.is_some(), "diff should be stored");

    let payload: serde_json::Value =
        serde_json::from_str(&diff.unwrap()).expect("diff is valid JSON");
    assert_eq!(payload["token"].as_str(), Some("unified-1"));
    assert!(
        payload["counts"]["current"].as_u64().unwrap_or(0) > 0,
        "diff should report non-zero current sections"
    );
}

/// A fresh install has nothing to migrate, so the one-shot token must not be
/// spent on an empty archive.
#[test]
fn a_fresh_install_is_not_owed_a_cutover() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    let owed = with_persistent_engine(|e| e.cutover_is_owed()).unwrap();
    assert!(
        !owed,
        "an empty catalogue on the compiled default is not a migration"
    );
    assert!(!veloqrs::persistence::cutover::start_cutover());
}

/// A run that died after the switch retries against a catalogue that already
/// says Unified. Re-archiving then would bury the snapshot the restore needs.
#[test]
fn a_resumed_run_reuses_its_archive_snapshot() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("first run");

    let snapshot = |p: &std::path::Path| -> Vec<(String, String)> {
        let db = rusqlite::Connection::open(p).expect("open");
        let mut stmt = db
            .prepare(
                "SELECT section_id, sport_type FROM section_catalogue_archive
                 ORDER BY section_id",
            )
            .expect("prepare");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows")
    };

    let before = snapshot(&path);
    assert!(!before.is_empty(), "nothing was archived");

    // Put the token back in flight, as a run that died after the switch does.
    {
        let db = rusqlite::Connection::open(&path).expect("open");
        db.execute(
            "UPDATE settings SET value = 'unified-1-inflight' WHERE key = '__detector_cutover'",
            [],
        )
        .expect("force in-flight");
    }
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    veloqrs::persistence::cutover::run_cutover().expect("resumed run");

    assert_eq!(
        before,
        snapshot(&path),
        "the resumed run overwrote the pre-cutover snapshot"
    );
}

/// Not-owed is a distinct outcome, not a failure and not a completed run.
#[test]
fn not_owed_is_a_distinct_outcome() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().unwrap(),
        CutoverOutcome::Completed(_)
    ));
    assert_eq!(
        veloqrs::persistence::cutover::run_cutover().unwrap(),
        CutoverOutcome::NotOwed
    );
}
