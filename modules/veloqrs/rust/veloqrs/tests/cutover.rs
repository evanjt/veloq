//! Cutover: archive, commit, cold detect, diff, promote.
//!
//! Synthetic coordinates only. Run: `cargo test --test detection_global -p veloqrs -- cutover::`

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::objects::observer::{EngineObserver, set_observer};
use veloqrs::persistence::cutover::CutoverOutcome;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::sections::{DETECTION_PHASE_CUTOVER_OWED, DETECTOR_METHOD};
use veloqrs::persistence::with_persistent_engine;
use veloqrs::sections::CreateSectionParams;

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

/// A library whose catalogue was cut by a build that did not record its
/// detector, the shape every install upgrading from 0.3.x arrives in.
fn seed_older_build_engine(path: &std::path::Path) {
    seed_older_build_engine_with(path, Some(3));
}

/// `min_activities` of `None` leaves the config at the validated defaults.
fn seed_older_build_engine_with(path: &std::path::Path, min_activities: Option<u32>) {
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        if let Some(min_activities) = min_activities {
            cfg.min_activities = min_activities;
        }
        engine
            .set_section_config(cfg)
            .expect("set the section config");
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

    // Run one detect so we have a catalogue to archive, then strip the
    // detector marker the way an older build would have left it.
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
    let db = rusqlite::Connection::open(path).expect("open");
    db.execute(
        "DELETE FROM schema_info WHERE key = 'catalogue_detection_method'",
        [],
    )
    .expect("strip the detector marker");
}

#[test]
fn cutover_archives_switches_and_detects() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    let pre_count = with_persistent_engine(|e| e.get_sections().len()).unwrap();
    assert!(pre_count > 0, "the seed detect produced no sections");

    let pre_method = with_persistent_engine(|e| e.catalogue_detection_method()).unwrap();
    assert_eq!(pre_method, None);

    // The cutover should be owed: the catalogue names no detector and no token exists.
    assert!(veloqrs::ffi::is_cutover_pending());

    let result = veloqrs::persistence::cutover::run_cutover();
    assert!(result.is_ok(), "cutover failed: {:?}", result.err());

    let CutoverOutcome::Completed(diff_json) = result.unwrap() else {
        panic!("the first run should complete, not report not-owed");
    };
    assert!(!diff_json.is_empty(), "diff payload is empty");

    // The re-cut catalogue names this build's detector.
    let post_method = with_persistent_engine(|e| e.catalogue_detection_method()).unwrap();
    assert_eq!(post_method.as_deref(), Some(DETECTOR_METHOD));

    // Should no longer be pending.
    assert!(!veloqrs::ffi::is_cutover_pending());

    // A second run is a no-op.
    let second = veloqrs::persistence::cutover::run_cutover().unwrap();
    assert_eq!(second, CutoverOutcome::NotOwed);
}

/// Scenario: the final apply of a cutover ranked the catalogue on the engine
/// lock, so every foreground read queued behind the track decode.
///
/// Expected behaviour: no ranking reads tracks under the lock, and the
/// catalogue still ends up scored.
#[test]
fn cutover_ranks_the_catalogue_off_the_engine_lock() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    let locked_before = veloqrs::persistence::sections::locked_rank_passes();
    let result = veloqrs::persistence::cutover::run_cutover();
    assert!(result.is_ok(), "cutover failed: {:?}", result.err());

    assert_eq!(
        veloqrs::persistence::sections::locked_rank_passes(),
        locked_before,
        "the cutover ranked the catalogue under the engine lock"
    );
    let db = rusqlite::Connection::open(&path).expect("open");
    let unscored: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE rank_score IS NULL",
            [],
            |r| r.get(0),
        )
        .expect("count");
    let total: i64 = db
        .query_row("SELECT COUNT(*) FROM sections", [], |r| r.get(0))
        .expect("count");
    assert!(total > 0, "the cutover produced no sections");
    assert_eq!(unscored, 0, "sections left unscored after the cutover");
}

#[test]
fn cutover_is_idempotent_on_rerun() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    let r1 = veloqrs::persistence::cutover::run_cutover();
    assert!(r1.is_ok());

    let r2 = veloqrs::persistence::cutover::run_cutover().unwrap();
    assert_eq!(r2, CutoverOutcome::NotOwed, "second run should be a no-op");
}

/// A run that dies after the switch leaves the token in flight. The config
/// already reads Unified, so only the token can say the migration is unfinished.
#[test]
fn an_interrupted_run_is_still_owed() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    // Stand in for a process that died between the switch and the diff.
    with_persistent_engine(|e| {
        e.set_setting("__detector_cutover", "unified-1-inflight")
            .expect("write in-flight token");
        e.set_section_config(e.get_section_config())
            .expect("set the section config");
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
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().unwrap();

    let diff = veloqrs::ffi::get_cutover_diff().expect("diff should be stored");

    assert_eq!(diff.token, "unified-1");
    assert!(
        diff.counts.current > 0,
        "diff should report non-zero current sections"
    );
}

/// A section is a reference activity and the indices of a pass over it, not
/// stored geometry, so the change card's payload carries neither the rows nor
/// the lines. Left in, the install held both catalogues' geometry a second
/// time for the life of the install.
#[test]
fn the_stored_diff_carries_no_section_rows() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().unwrap();

    let diff = veloqrs::ffi::get_cutover_diff().expect("diff is stored");
    assert!(diff.counts.current > 0);

    // The record carries no rows by its shape, so the claim is about the row
    // the engine keeps: it holds token, counts and settings_reset only.
    let stored = with_persistent_engine(|e| e.get_setting("__detector_cutover_diff"))
        .expect("engine")
        .expect("setting readable")
        .expect("still stored");
    let payload: serde_json::Value = serde_json::from_str(&stored).expect("diff is valid JSON");
    assert!(
        payload.get("sections").is_none(),
        "the payload keeps token, counts and settings_reset only: {payload}"
    );
}

/// An install that migrated on an older build keeps the fat row for ever: the
/// key is written once at promotion and deleted only by the sign-out wipe. So
/// the trim has to happen on the way out, once.
#[test]
fn a_payload_an_older_build_wrote_is_trimmed_when_it_is_read() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().unwrap();

    let fat = serde_json::json!({
        "token": "unified-1",
        "counts": { "current": 3, "proposed": 4, "unchanged": 2,
                    "changed": 1, "new": 1, "gone": 0 },
        "sections": [{ "id": "s1", "status": "gone", "polyline": "yyyy}}}}" }],
        "settings_reset": serde_json::Value::Null,
    })
    .to_string();
    with_persistent_engine(|e| {
        e.set_setting("__detector_cutover_diff", &fat)
            .expect("seed the older build's payload")
    })
    .expect("engine");

    let read = veloqrs::ffi::get_cutover_diff().expect("diff is stored");
    assert_eq!(read.counts.current, 3);
    assert_eq!(read.token, "unified-1");

    let stored = with_persistent_engine(|e| e.get_setting("__detector_cutover_diff"))
        .expect("engine")
        .expect("setting readable")
        .expect("still stored");
    assert!(
        !stored.contains("\"sections\""),
        "the row itself is rewritten, not only the copy handed back: {stored}"
    );
}

/// A fresh install has nothing to migrate, so the one-shot token must not be
/// spent on an empty archive.
#[test]
fn a_fresh_install_is_not_owed_a_cutover() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    let owed = with_persistent_engine(|e| e.cutover_is_owed()).unwrap();
    assert!(
        !owed,
        "an empty catalogue on the compiled default is not a migration"
    );
    assert_eq!(
        veloqrs::persistence::cutover::start_cutover(),
        veloqrs::objects::FfiStartOutcome::NotOwed
    );
}

#[test]
fn elevation_owed_holds_the_native_cutover_start() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let remaining = with_persistent_engine(|e| e.elevation_backfill_remaining())
        .unwrap()
        .expect("remaining");
    assert!(remaining > 0);

    assert_eq!(
        veloqrs::persistence::cutover::start_cutover(),
        veloqrs::objects::FfiStartOutcome::Held
    );
    assert!(with_persistent_engine(|e| e.cutover_is_owed()).unwrap());
}

/// Scenario: a caller asks for the cutover while a run already holds the
/// slot, with nothing else standing in the way.
/// Expected behaviour: busy, and the run in flight completes on its own.
#[test]
fn a_start_while_a_run_holds_the_slot_is_busy() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let db = rusqlite::Connection::open(&path).expect("open");
    db.execute("UPDATE gps_tracks SET elevation_state = 1", [])
        .expect("every track fetched");
    assert_eq!(
        with_persistent_engine(|e| e.elevation_backfill_remaining())
            .unwrap()
            .expect("remaining"),
        0
    );

    let answer = Mutex::new(None);
    let outcome = veloqrs::persistence::cutover::run_cutover_with(&|_phase| {
        answer
            .lock()
            .unwrap()
            .get_or_insert_with(veloqrs::persistence::cutover::start_cutover);
        false
    })
    .expect("the run in flight");

    assert_eq!(
        *answer.lock().unwrap(),
        Some(veloqrs::objects::FfiStartOutcome::Busy)
    );
    assert!(matches!(outcome, CutoverOutcome::Completed(_)));
}

#[test]
fn unreadable_elevation_count_keeps_cutover_not_ready() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let db = rusqlite::Connection::open(&path).expect("open");
    db.execute_batch("DROP TABLE activities")
        .expect("break the elevation query");

    assert_eq!(
        veloqrs::persistence::cutover::start_cutover(),
        veloqrs::objects::FfiStartOutcome::NotReady
    );
    assert!(with_persistent_engine(|e| e.cutover_is_owed()).unwrap());
}

#[test]
fn net_zero_activity_swap_during_cutover_leaves_detection_dirty() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let detecting_checks = AtomicUsize::new(0);
    let outcome = veloqrs::persistence::cutover::run_cutover_with(&|phase| {
        if phase == "detecting" && detecting_checks.fetch_add(1, Ordering::SeqCst) == 1 {
            with_persistent_engine(|e| {
                let before = e.get_activity_ids().len();
                e.remove_departed_activity("ride_0").expect("remove");
                e.add_activity("ride_new".into(), line_track(0.002), "Ride".into())
                    .expect("arrival");
                assert_eq!(e.get_activity_ids().len(), before);
            })
            .expect("engine");
        }
        false
    })
    .expect("cutover");

    assert!(matches!(outcome, CutoverOutcome::Completed(_)));
    assert_eq!(detecting_checks.load(Ordering::SeqCst), 2);
    assert!(with_persistent_engine(|e| e.stats().sections_dirty).unwrap());
}

/// A run that died after the switch retries against a catalogue that already
/// says Unified. Re-archiving then would bury the snapshot the diff needs.
#[test]
fn a_resumed_run_reuses_its_archive_snapshot() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("first run");

    let snapshot = |p: &std::path::Path| -> Vec<(String, String)> {
        let db = rusqlite::Connection::open(p).expect("open");
        let mut stmt = db
            .prepare(
                "SELECT section_id, json_extract(details, '$.sport_type') FROM section_history
                 WHERE kind = 'archived' ORDER BY section_id",
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
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().unwrap(),
        CutoverOutcome::Completed(_)
    ));
    assert_eq!(
        veloqrs::persistence::cutover::run_cutover().unwrap(),
        CutoverOutcome::NotOwed
    );
}

/// A full reset drops the catalogue, so it must drop the token and config that
/// describe it. Otherwise the next athlete inherits a spent cutover and a
/// detector they cannot change.
#[test]
fn clear_drops_the_cutover_token_and_config() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("cutover");
    // The cutover itself resets the config, so the athlete moves it again
    // afterwards: otherwise the defaults below prove nothing about `clear`.
    with_persistent_engine(|e| {
        let mut cfg = e.get_section_config();
        cfg.min_activities = 5;
        e.set_section_config(cfg).expect("set the section config");
    })
    .unwrap();
    with_persistent_engine(|e| e.clear().expect("clear")).unwrap();
    assert_eq!(
        with_persistent_engine(|e| e.get_section_config()).unwrap(),
        tracematch::SectionConfig::default(),
        "the live engine kept the previous athlete's config"
    );
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    assert_eq!(
        with_persistent_engine(|e| e.get_section_config()).unwrap(),
        tracematch::SectionConfig::default(),
        "the reopened engine read the previous athlete's config"
    );

    let leftovers: i64 = {
        let db = rusqlite::Connection::open(&path).expect("open");
        db.query_row(
            "SELECT COUNT(*) FROM settings
             WHERE key IN ('__detector_cutover', '__detector_cutover_diff',
                           '__section_config_json', '__section_proximity_threshold',
                           '__section_min_length', '__section_min_activities')",
            [],
            |row| row.get(0),
        )
        .expect("count")
    };
    assert_eq!(leftovers, 0, "cutover state outlived the reset");
}

#[test]
fn diff_write_failure_keeps_cutover_in_flight_for_retry() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let db = rusqlite::Connection::open(&path).expect("open");
    db.execute_batch(
        "CREATE TRIGGER reject_cutover_diff BEFORE INSERT ON settings
         WHEN NEW.key = '__detector_cutover_diff'
         BEGIN SELECT RAISE(ABORT, 'diff write blocked'); END;",
    )
    .expect("trigger");

    assert!(veloqrs::persistence::cutover::run_cutover().is_err());
    // The new catalogue was applied before the diff write failed, so the run
    // must not settle on the phase that says the sections are unchanged.
    assert_eq!(
        veloqrs::persistence::cutover::cutover_phase(),
        "failed_after_apply"
    );
    let token: String = db
        .query_row(
            "SELECT value FROM settings WHERE key = '__detector_cutover'",
            [],
            |row| row.get(0),
        )
        .expect("token");
    assert_eq!(token, "unified-1-inflight");
    let archived_lines: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM section_history
             WHERE kind = 'archived' AND geometry_version IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .expect("archive");
    assert!(archived_lines > 0);

    db.execute_batch("DROP TRIGGER reject_cutover_diff")
        .expect("drop trigger");
    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().expect("retry"),
        CutoverOutcome::Completed(_)
    ));
    let persisted: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = '__detector_cutover_diff'",
            [],
            |row| row.get(0),
        )
        .expect("diff");
    assert_eq!(persisted, 1);
}

#[test]
fn accepted_custom_trimmed_named_and_pinned_sections_survive_cutover() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let auto_id = with_persistent_engine(|e| e.get_sections()[0].id.clone()).unwrap();
    let db = rusqlite::Connection::open(&path).expect("open");
    for id in ["accepted_copy", "trimmed_copy"] {
        db.execute(
            "INSERT INTO sections
             (id, section_type, name, sport_type, polyline_json, polyline_blob,
              distance_meters)
             SELECT ?1, 'auto', ?1, sport_type, polyline_json, polyline_blob,
                    distance_meters
             FROM sections WHERE id = ?2",
            rusqlite::params![id, auto_id],
        )
        .expect("copy section for user edit");
    }
    with_persistent_engine(|e| {
        e.accept_section("accepted_copy").expect("accept");
        e.trim_section("trimmed_copy", 1, 8).expect("trim");
    })
    .unwrap();
    let custom = with_persistent_engine(|e| {
        e.create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: line_track(0.001)[0..40].to_vec(),
            distance_meters: 500.0,
            name: Some("Hand cut".into()),
            source_activity_id: Some("ride_0".into()),
            start_index: Some(0),
            end_index: Some(39),
        })
        .expect("custom")
    })
    .unwrap();
    with_persistent_engine(|e| e.set_section_name(&auto_id, Some("Named corridor")))
        .unwrap()
        .expect("name");
    db.execute(
        "INSERT INTO section_geometry (section_id, version, blob, source)
         SELECT 'accepted_copy', 1, polyline_blob, 'consensus'
         FROM sections WHERE id = 'accepted_copy'",
        [],
    )
    .expect("version");
    with_persistent_engine(|e| e.pin_section_geometry("accepted_copy", 1))
        .unwrap()
        .expect("pin");

    let before: Vec<(String, Vec<u8>, String)> = ["accepted_copy", "trimmed_copy", &custom]
        .iter()
        .map(|id| {
            db.query_row(
                "SELECT id, polyline_blob, name FROM sections WHERE id = ?",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("section before")
        })
        .collect();
    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().expect("cutover"),
        CutoverOutcome::Completed(_)
    ));
    for (id, blob, name) in before {
        let after: (Vec<u8>, String) = db
            .query_row(
                "SELECT polyline_blob, name FROM sections WHERE id = ?",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("section survived");
        assert_eq!(after, (blob, name));
        let archived: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM section_history WHERE section_id = ? AND kind = 'archived'",
                [&id],
                |row| row.get(0),
            )
            .expect("archive count");
        assert_eq!(archived, 0);
    }
    let pin: i64 = db
        .query_row(
            "SELECT version FROM section_pins WHERE section_id = 'accepted_copy'",
            [],
            |row| row.get(0),
        )
        .expect("pin survived");
    assert_eq!(pin, 1);
    let named: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE kind = 'named' AND name = 'Named corridor'",
            [],
            |row| row.get(0),
        )
        .expect("name intent");
    assert_eq!(named, 1);
}

/// Scenario: the athlete named an auto section, which the cutover archives
/// and re-cuts like any other.
/// Expected behaviour: the intent surviving is not the name surviving, so the
/// name has to resolve onto a live section of the new catalogue. The survival
/// test above cannot show this: its accepted and trimmed copies hold the named
/// ground, so the cold cut emits no auto section there and the name is
/// dormant by design.
#[test]
fn a_named_corridor_keeps_its_name_across_the_cutover() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let auto_id = with_persistent_engine(|e| e.get_sections()[0].id.clone()).unwrap();
    with_persistent_engine(|e| e.set_section_name(&auto_id, Some("Named corridor")))
        .unwrap()
        .expect("name");

    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().expect("cutover"),
        CutoverOutcome::Completed(_)
    ));

    let names = with_persistent_engine(|e| e.get_all_section_names()).unwrap();
    let live: std::collections::HashSet<String> =
        with_persistent_engine(|e| e.get_sections().iter().map(|s| s.id.clone()).collect())
            .unwrap();
    assert!(
        names
            .iter()
            .any(|(id, name)| name == "Named corridor" && live.contains(id)),
        "no live section carries the name after the cut: {names:?}"
    );
}

#[test]
fn disabled_corridor_stays_hidden_during_cutover() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let disabled_id = with_persistent_engine(|e| e.get_sections()[0].id.clone()).unwrap();
    let db = rusqlite::Connection::open(&path).expect("open");
    db.execute(
        "INSERT INTO sections
         (id, section_type, sport_type, polyline_json, polyline_blob, distance_meters)
         SELECT 'active_copy', section_type, sport_type, polyline_json, polyline_blob,
                distance_meters FROM sections WHERE id = ?",
        [&disabled_id],
    )
    .expect("active section");
    with_persistent_engine(|e| e.disable_section(&disabled_id))
        .unwrap()
        .expect("disable");
    let intent_before: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE kind = 'disabled'",
            [],
            |row| row.get(0),
        )
        .expect("intent");
    assert_eq!(intent_before, 1);

    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().expect("cutover"),
        CutoverOutcome::Completed(_)
    ));
    let disabled: i64 = db
        .query_row(
            "SELECT disabled FROM sections WHERE id = ?",
            [&disabled_id],
            |row| row.get(0),
        )
        .expect("disabled row");
    assert_eq!(disabled, 1);
    let intent_after: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE kind = 'disabled'",
            [],
            |row| row.get(0),
        )
        .expect("intent after");
    assert_eq!(intent_after, intent_before);
    let visible: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE disabled = 0 AND is_user_defined = 0",
            [],
            |row| row.get(0),
        )
        .expect("visible count");
    assert_eq!(visible, 0);
}

/// The diff is the change card's whole content. Ids are minted by the identity
/// registry, so a filter keyed on any id prefix silently empties the live side
/// and reports the entire catalogue as lost.
#[test]
fn the_diff_sees_the_catalogue_the_cut_produced() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    let CutoverOutcome::Completed(json) =
        veloqrs::persistence::cutover::run_cutover().expect("cutover")
    else {
        panic!("the first run should complete");
    };

    let diff: serde_json::Value = serde_json::from_str(&json).expect("diff parses");
    let counts = &diff["counts"];
    let proposed = counts["proposed"].as_u64().expect("proposed");
    let gone = counts["gone"].as_u64().expect("gone");
    let current = counts["current"].as_u64().expect("current");

    assert!(
        proposed > 0,
        "the cut produced sections but the diff sees none: {counts}"
    );
    assert!(
        gone < current,
        "every archived section reported lost, which means the live side was empty: {counts}"
    );
}

/// A migrated section's line is a verbatim slice of one real track, so it owes
/// a range that re-slices to it. The opposite claim sat in a comment for months
/// while the field was hardcoded to None, because nothing asserted it. This is
/// what lets the pre-cutover catalogue be stored as a reference.
#[test]
fn a_migrated_section_records_the_range_it_was_sliced_from() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    // id, representative activity, start, end, geometry source
    type ReferenceRow = (
        String,
        Option<String>,
        Option<u32>,
        Option<u32>,
        Option<String>,
    );
    let rows: Vec<ReferenceRow> = {
        let db = rusqlite::Connection::open(&path).expect("open");
        let mut stmt = db
            .prepare(
                "SELECT id, representative_activity_id, rep_start_index, rep_end_index,
                        geometry_source
                 FROM sections WHERE section_type = 'auto' ORDER BY id",
            )
            .expect("prepare");
        stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .expect("query")
        .collect::<Result<Vec<_>, _>>()
        .expect("rows")
    };
    assert!(!rows.is_empty(), "the seed detect produced no sections");

    let mut checked = 0;
    for (id, rep, start, end, source) in &rows {
        assert_eq!(
            source.as_deref(),
            Some("exact"),
            "section {id} was stored without a usable reference"
        );
        let rep = rep.as_deref().expect("an exact row names its activity");
        let (start, end) = (start.expect("start") as usize, end.expect("end") as usize);

        let (track, polyline) = with_persistent_engine(|e| {
            let track = e.get_gps_track(rep).expect("the stream is stored");
            let polyline = e.get_section_by_id(id).expect("readable").polyline;
            (track, polyline)
        })
        .unwrap();

        assert_eq!(
            &track[start..end],
            polyline.as_slice(),
            "section {id} does not re-slice to the line it drew"
        );
        checked += 1;
    }
    assert!(checked > 0, "nothing was checked");
}

/// Scenario: the detector generation changes under a catalogue the old one cut.
/// Expected behaviour: no section keeps the old detector's geometry.
///
/// The debounce exists to absorb detector noise over `k` detects. A cutover is
/// not noise, so `commit_switch` arms the registry decisive: a section whose
/// new extents disagree with its old ones adopts the new line in one step
/// instead of carrying frozen. A frozen carry keeps the older averaged
/// polyline and its NULL reference alive under a Unified label, which is the
/// one thing the migration exists to prevent.
///
/// This asserts the invariant, not the fix: the synthetic seed's two cuts agree
/// on extents, so it adopts either way and passes with the arm removed. The
/// measurement that made the arm necessary is in `corpus_migration.rs`, where a
/// real 1,201-activity library carried seven frozen. Only a corpus reproduces
/// the disagreement, so only a corpus can guard it.
#[test]
fn no_section_keeps_an_older_build_geometry_across_the_cutover() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("cutover");

    let db = rusqlite::Connection::open(&path).expect("open");
    let stranded: Vec<String> = db
        .prepare(
            "SELECT id FROM sections
             WHERE section_type = 'auto'
               AND (geometry_source IS NULL OR geometry_source != 'exact'
                    OR rep_start_index IS NULL OR rep_end_index IS NULL
                    OR COALESCE(representative_activity_id, '') = '')",
        )
        .expect("prepare")
        .query_map([], |r| r.get(0))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows");

    let total: u32 = db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE section_type = 'auto'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert!(
        total > 0,
        "the migrated catalogue is empty, so this is vacuous"
    );
    assert!(
        stranded.is_empty(),
        "{} of {total} migrated sections carry a line no activity can re-slice",
        stranded.len()
    );
}

// ───────────────────────────────────────────────────────────────────
// The settle announcement
// ───────────────────────────────────────────────────────────────────

/// What the engine looked like at the instant the observer was told.
#[derive(Debug)]
struct Settle {
    running: bool,
    phase: String,
    lock_free: bool,
    diff_readable: bool,
}

/// Records one snapshot per settle it is told about.
struct SettleRecorder {
    settles: Mutex<Vec<Settle>>,
}

impl SettleRecorder {
    fn new() -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self {
            settles: Mutex::new(Vec::new()),
        })
    }

    fn count(&self) -> usize {
        self.settles.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    fn with<R>(&self, f: impl FnOnce(&Settle) -> R) -> R {
        let settles = self.settles.lock().unwrap_or_else(|e| e.into_inner());
        f(settles.first().expect("no settle was announced"))
    }
}

impl EngineObserver for SettleRecorder {
    fn sync_progress(&self) {}
    fn sync_settled(&self) {}
    fn activities_stored(&self) {}
    fn body_stored(&self, _kind: String, _activity_id: String) {}
    fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
    fn gps_track_stored(&self, _activity_id: String) {}
    fn gps_tracks_mutated(&self, _activity_ids: Vec<String>) {}
    fn fit_parsed(&self, _activity_id: String) {}
    fn detection_applied(&self) {}
    fn tiles_generated(&self) {}
    fn backfill_phase(&self, _phase: String) {}
    fn stream_backfill_phase(&self, _phase: String) {}
    fn preview_phase(&self, _phase: String) {}
    fn cutover_settled(&self) {
        // A blocking take would hang rather than fail if the run still held the
        // engine, so the lock is probed and the diff read only if it is free.
        let lock_free = veloqrs::persistence::PERSISTENT_ENGINE.try_lock().is_ok();
        let progress = veloqrs::ffi::get_cutover_progress();
        self.settles
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(Settle {
                running: progress.running,
                phase: progress.phase,
                lock_free,
                diff_readable: lock_free && veloqrs::ffi::get_cutover_diff().is_some(),
            });
    }
    fn preview_finished(&self) {}
    fn recordings_changed(&self) {}
    fn upload_permission_refused(&self) {}
}

/// The change card hears the commit rather than polling for it. A completed
/// run has to reach the observer exactly once, with the engine lock free
/// (the binding blocks this thread until JavaScript returns), and with
/// everything the card then reads already durable.
#[test]
fn a_completed_cutover_announces_the_settle_once_the_write_is_committed() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    let recorder = SettleRecorder::new();
    set_observer(Some(recorder.clone()));
    let outcome = veloqrs::persistence::cutover::run_cutover().expect("cutover");
    veloqrs::objects::observer::flush();
    set_observer(None);

    assert!(matches!(outcome, CutoverOutcome::Completed(_)));
    assert_eq!(recorder.count(), 1, "a completed run announces once");
    recorder.with(|settle| {
        assert!(settle.lock_free, "the announce came under the engine lock");
        assert!(!settle.running, "the running flag was still up: {settle:?}");
        assert_eq!(settle.phase, "complete");
        assert!(settle.diff_readable, "the diff was not stored yet");
    });
}

/// A run with nothing to migrate is not news. Announcing it would have the
/// card report a rebuild that never happened.
#[test]
fn a_run_that_is_not_owed_announces_nothing() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    veloqrs::persistence::cutover::run_cutover().expect("first run");

    let recorder = SettleRecorder::new();
    set_observer(Some(recorder.clone()));
    let outcome = veloqrs::persistence::cutover::run_cutover().expect("second run");
    veloqrs::objects::observer::flush();
    set_observer(None);

    assert_eq!(outcome, CutoverOutcome::NotOwed);
    assert_eq!(recorder.count(), 0, "a not-owed run announced a settle");
}

/// A failure partway is the one result the card has to be told about, since
/// the failed line is all a user who never saw the run gets. The guard clears
/// the flag and announces on every exit, not only the successful one.
#[test]
fn a_failed_cutover_announces_the_settle() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    refuse_the_archive(&path);

    let recorder = SettleRecorder::new();
    set_observer(Some(recorder.clone()));
    let result = veloqrs::persistence::cutover::run_cutover();
    veloqrs::objects::observer::flush();
    set_observer(None);

    assert!(result.is_err(), "the archive was supposed to be refused");
    assert_eq!(recorder.count(), 1, "a failed run announces once");
    recorder.with(|settle| {
        assert!(settle.lock_free, "the announce came under the engine lock");
        assert!(!settle.running, "the running flag was still up: {settle:?}");
        assert_ne!(
            settle.phase, "complete",
            "a failed run announced as complete"
        );
    });

    // The failure left the cutover owed, so a later launch retries it.
    assert!(veloqrs::ffi::is_cutover_pending());
}

/// Refuses every archive insert, which fails the cutover at its first write.
fn refuse_the_archive(path: &std::path::Path) {
    rusqlite::Connection::open(path)
        .expect("open")
        .execute_batch(
            "CREATE TRIGGER refuse_archive BEFORE INSERT ON section_history
             WHEN NEW.kind = 'archived'
             BEGIN SELECT RAISE(ABORT, 'archive refused'); END",
        )
        .expect("install the refusal");
}

/// Any detect at all used to move the catalogue's detector marker, which
/// retires the cutover. On the upgrade path that meant a sync-triggered detect
/// could re-cut the pre-0.4.0 catalogue and stamp it Unified before anything
/// had captured it, losing the migration and its change card with it.
#[test]
fn detection_is_refused_while_a_cutover_is_owed() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    assert!(veloqrs::ffi::is_cutover_pending());
    let before = with_persistent_engine(|e| e.get_sections().len()).unwrap();

    let phase =
        with_persistent_engine(|e| e.detect_sections_background().get_progress().0).unwrap();
    assert_eq!(phase, DETECTION_PHASE_CUTOVER_OWED);

    // The marker still says no detector, so the cutover is still owed and the
    // catalogue is the one the user arrived with.
    assert_eq!(
        with_persistent_engine(|e| e.catalogue_detection_method()).unwrap(),
        None
    );
    assert_eq!(
        with_persistent_engine(|e| e.get_sections().len()).unwrap(),
        before
    );
    assert!(veloqrs::ffi::is_cutover_pending());
}

/// The conditioning arm is the one SB12's failing case runs down: a sync adds
/// activities, the backfill defers, and nothing else holds a detect back.
#[test]
fn conditioning_will_not_start_while_a_cutover_is_owed() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    assert!(!veloqrs::persistence::sections::conditioning::try_start_conditioning());
    assert!(veloqrs::ffi::is_cutover_pending());
}

/// Once the cutover has run the gate lifts, or the install would never detect
/// again.
#[test]
fn detection_resumes_once_the_cutover_is_done() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("cutover");
    assert!(!veloqrs::ffi::is_cutover_pending());

    let phase =
        with_persistent_engine(|e| e.detect_sections_background().get_progress().0).unwrap();
    assert_ne!(phase, DETECTION_PHASE_CUTOVER_OWED);
}

/// A fresh install is owed nothing, so the gate must never close on one.
#[test]
fn a_fresh_install_detects_normally() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    assert!(!veloqrs::ffi::is_cutover_pending());
    let phase =
        with_persistent_engine(|e| e.detect_sections_background().get_progress().0).unwrap();
    assert_ne!(phase, DETECTION_PHASE_CUTOVER_OWED);
}

/// Content-derived ids make one cut reproducible. They do not make two devices
/// cut the same way: the parameters are per device and no server holds them,
/// so the row is only honest while the config is the one the build was
/// validated at.
#[test]
fn identical_sections_is_claimed_only_at_the_validated_configuration() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    with_persistent_engine(|engine| {
        engine
            .set_section_config(tracematch::sections::SectionConfig::default())
            .expect("set the section config");
        assert!(
            engine.change_card_support().same_on_every_device,
            "a default install is at the validated configuration"
        );

        let mut strict = engine.get_section_config();
        strict.proximity_threshold = 75.0;
        engine
            .set_section_config(strict)
            .expect("set the section config");
        assert!(
            !engine.change_card_support().same_on_every_device,
            "a device carrying its own proximity threshold cuts differently"
        );

        engine
            .set_section_config(tracematch::sections::SectionConfig {
                min_activities: 4,
                ..Default::default()
            })
            .expect("set the section config");
        assert!(
            !engine.change_card_support().same_on_every_device,
            "any parameter away from the validated value breaks the claim"
        );

        engine
            .set_section_config(tracematch::sections::SectionConfig::default())
            .expect("set the section config");
        assert!(
            engine.change_card_support().same_on_every_device,
            "the claim comes back once the config is the validated one again"
        );
    })
    .unwrap();
}

/// `run_cutover_claimed` stamps `failed` up front and `PhaseClock::enter`
/// overwrites it on the way through, so a run that died partway reported the
/// step it died inside. The change card reads that string as "not failed" and
/// shows the previous run's counts as this run's result.
#[test]
fn a_run_that_dies_partway_settles_on_failed() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    // Break step 1 from a second connection, so the run fails after the clock
    // has already entered a phase and erased the up-front marker.
    refuse_the_archive(&path);

    let result = veloqrs::persistence::cutover::run_cutover();
    assert!(result.is_err(), "the archive should have failed");

    assert_eq!(veloqrs::persistence::cutover::cutover_phase(), "failed");
    assert!(!veloqrs::persistence::cutover::cutover_running());
    // The token was never promoted, so the next launch retries the whole run.
    assert!(veloqrs::ffi::is_cutover_pending());
}

/// The failure marker must not fire on the two paths that are not failures.
#[test]
fn a_completed_run_settles_on_complete() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("cutover");

    assert_eq!(veloqrs::persistence::cutover::cutover_phase(), "complete");
    assert!(!veloqrs::persistence::cutover::cutover_running());
}

#[test]
fn a_run_with_nothing_owed_settles_on_idle() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("first cutover");
    let second = veloqrs::persistence::cutover::run_cutover().expect("second cutover");
    assert_eq!(second, CutoverOutcome::NotOwed);

    assert_eq!(veloqrs::persistence::cutover::cutover_phase(), "idle");
}

/// The blob 0.3.8's settings screen wrote: four sliders away from the
/// validated values and four fields today's `SectionConfig` no longer has.
const STRICT_038_BLOB: &str = r#"{"proximityThreshold":100.0,"minSectionLength":50.0,"maxSectionLength":200000.0,"minActivities":3,"divergenceThreshold":0.1,"minCorridorTracks":3,"minRoutes":2,"jaccardThreshold":0.5,"minCellVisits":2}"#;

fn stored_section_config(path: &std::path::Path) -> tracematch::SectionConfig {
    let db = rusqlite::Connection::open(path).expect("open");
    let json: String = db
        .query_row(
            "SELECT value FROM settings WHERE key = '__section_config_json'",
            [],
            |row| row.get(0),
        )
        .expect("config blob");
    serde_json::from_str(&json).expect("config parses")
}

fn seed_strict_038_engine(path: &std::path::Path) {
    seed_older_build_engine(path);
    with_persistent_engine(|e| {
        e.set_setting("__section_config_json", STRICT_038_BLOB)
            .expect("write the 0.3.8 blob");
    })
    .unwrap();
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
}

/// Scenario: an install upgrading from 0.3.8 carries the sliders that screen
/// let the athlete move, and the detector is validated at one configuration.
/// Expected behaviour: the flip leaves the stored config at the validated
/// values and the diff names what it moved, so the card can say so.
#[test]
fn the_cutover_resets_a_strict_config_to_the_validated_defaults() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_strict_038_engine(&path);

    let loaded = with_persistent_engine(|e| e.get_section_config()).unwrap();
    assert_eq!(
        loaded.proximity_threshold, 100.0,
        "the 0.3.8 blob did not load"
    );
    assert_eq!(loaded.min_activities, 3);

    let CutoverOutcome::Completed(diff_json) =
        veloqrs::persistence::cutover::run_cutover().expect("cutover")
    else {
        panic!("the first run should complete");
    };

    let defaults = tracematch::SectionConfig::default();
    assert_eq!(stored_section_config(&path), defaults);
    assert_eq!(
        with_persistent_engine(|e| e.get_section_config()).unwrap(),
        defaults
    );

    let payload: serde_json::Value = serde_json::from_str(&diff_json).expect("diff parses");
    let previous = &payload["settings_reset"]["previous"];
    assert_eq!(previous["proximityThreshold"].as_f64(), Some(100.0));
    assert_eq!(previous["minSectionLength"].as_f64(), Some(50.0));
    assert_eq!(previous["minActivities"].as_u64(), Some(3));
    assert_eq!(previous["divergenceThreshold"].as_f64(), Some(0.1));
    let current = &payload["settings_reset"]["current"];
    assert_eq!(current["proximityThreshold"].as_f64(), Some(200.0));
    assert_eq!(current["minActivities"].as_u64(), Some(2));
}

/// A library already at the validated values has no settings change to
/// report, or every upgrade would be told about a reset it did not have.
#[test]
fn a_cutover_already_at_the_defaults_reports_no_settings_change() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine_with(&path, None);

    let CutoverOutcome::Completed(diff_json) =
        veloqrs::persistence::cutover::run_cutover().expect("cutover")
    else {
        panic!("the first run should complete");
    };

    let payload: serde_json::Value = serde_json::from_str(&diff_json).expect("diff parses");
    assert!(
        payload["settings_reset"].is_null(),
        "a config at the defaults reported a reset: {}",
        payload["settings_reset"]
    );
    assert_eq!(
        stored_section_config(&path),
        tracematch::SectionConfig::default()
    );
}

/// The four fields 0.3.8 wrote and today's config lacks are dropped on load,
/// never a parse failure that would silently fall back to the defaults.
#[test]
fn a_038_blob_with_retired_fields_still_loads() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_strict_038_engine(&path);

    let loaded = with_persistent_engine(|e| e.get_section_config()).unwrap();
    assert_eq!(loaded.proximity_threshold, 100.0);
    assert_eq!(loaded.min_section_length, 50.0);
    assert_eq!(loaded.max_section_length, 200_000.0);
    assert_eq!(loaded.min_activities, 3);
    assert_eq!(loaded.divergence_threshold, 0.1);
    assert!(
        loaded.pool_sports,
        "a blob without pool_sports must default it on"
    );
}

/// Scenario: the cut fires unattended at launch, rebuilds the whole catalogue,
/// and the only lever the athlete had was force-quit, which the in-flight
/// token undid on the next launch.
///
/// Expected behaviour: a cancel ends the run at the next step boundary and
/// leaves the library in a state the crash path already handles, so the next
/// launch resumes it. Cancelling is "not this session", never "not ever": the
/// token is what says the migration is still owed and a cancel must not
/// promote it.
///
/// The stop signal is handed in rather than raced. A real cancel against this
/// fixture would have to arrive inside a run that finishes in milliseconds,
/// which tests the clock rather than the boundary.
mod a_cancelled_cutover {
    use super::*;
    use veloqrs::persistence::cutover::{
        PHASE_ARCHIVING, PHASE_DETECTING, PHASE_DRAINING, cancel_cutover, cutover_cancelled,
        cutover_running, run_cutover, run_cutover_with,
    };

    fn seeded() -> (TempDir, usize) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        seed_older_build_engine(&path);
        let sections = with_persistent_engine(|e| e.get_sections().len()).unwrap();
        assert!(sections > 0, "the seed detect produced no sections");
        (dir, sections)
    }

    fn stop_in(phase: &'static str) -> impl Fn(&str) -> bool + Sync {
        move |at: &str| at == phase
    }

    /// Before the archive: nothing has been written, so the athlete keeps the
    /// catalogue they had and the migration is owed exactly as it was.
    #[test]
    fn stopped_in_the_drain_changes_nothing() {
        let _serial_state = crate::serial_state();
        let (_dir, before) = seeded();

        let outcome = run_cutover_with(&stop_in(PHASE_DRAINING)).expect("cancelled, not failed");

        assert_eq!(outcome, CutoverOutcome::Cancelled);
        assert!(veloqrs::ffi::is_cutover_pending(), "still owed");
        assert_eq!(
            with_persistent_engine(|e| e.get_sections().len()).unwrap(),
            before,
            "the catalogue was rebuilt anyway"
        );
        assert!(!cutover_running(), "the slot is given back");
    }

    /// After the archive and before the switch. The archive is additive and
    /// idempotent per token, which is what makes this the same state a crash
    /// here already leaves.
    #[test]
    fn stopped_after_the_archive_leaves_the_athlete_on_the_old_detector() {
        let _serial_state = crate::serial_state();
        let (_dir, before) = seeded();

        let outcome = run_cutover_with(&stop_in(PHASE_ARCHIVING)).expect("cancelled");

        assert_eq!(outcome, CutoverOutcome::Cancelled);
        assert!(veloqrs::ffi::is_cutover_pending(), "still owed");
        assert_eq!(
            with_persistent_engine(|e| e.get_sections().len()).unwrap(),
            before
        );
    }

    /// Past the switch the token is in flight, and an in-flight token is
    /// always owed. That is what makes the next launch run this again from the
    /// top rather than waving a half-migrated install through.
    #[test]
    fn stopped_after_the_switch_leaves_the_token_in_flight() {
        let _serial_state = crate::serial_state();
        let (_dir, _before) = seeded();

        let outcome = run_cutover_with(&stop_in(PHASE_DETECTING)).expect("cancelled");

        assert_eq!(outcome, CutoverOutcome::Cancelled);
        assert!(
            veloqrs::ffi::is_cutover_pending(),
            "an in-flight token is owed, so the next launch resumes"
        );
    }

    /// Every stopping point is one the next run recovers from, so the run
    /// after a cancel finishes the job rather than inheriting a broken half.
    #[test]
    fn is_finished_by_the_run_that_follows_it() {
        let _serial_state = crate::serial_state();
        let (_dir, _before) = seeded();

        for phase in [PHASE_DRAINING, PHASE_ARCHIVING, PHASE_DETECTING] {
            assert_eq!(
                run_cutover_with(&stop_in(phase)).expect("cancelled"),
                CutoverOutcome::Cancelled,
                "stopping in {phase}"
            );
        }

        let finished = run_cutover().expect("the next run is not refused");
        assert!(
            matches!(finished, CutoverOutcome::Completed(_)),
            "got {finished:?}"
        );
        assert!(!veloqrs::ffi::is_cutover_pending());
    }

    /// The cancel belongs to the run it stopped. A flag left standing would
    /// refuse the next launch's run before it started, which is the "not ever"
    /// this is not.
    #[test]
    fn does_not_carry_into_the_next_run() {
        let _serial_state = crate::serial_state();
        let (_dir, _before) = seeded();

        cancel_cutover();
        assert!(cutover_cancelled(), "the flag is set");

        let outcome = run_cutover().expect("cutover");

        assert!(
            matches!(outcome, CutoverOutcome::Completed(_)),
            "a cancel with no run in flight must not arm itself against the next one, got {outcome:?}"
        );
        assert!(
            !cutover_cancelled(),
            "and the run clears it as it claims the slot"
        );
    }
}

fn track_at(latitude: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: latitude + f64::from(i) * 0.0001,
            longitude: 9.0,
            elevation: None,
        })
        .collect()
}

fn route_of(groups: &[tracematch::RouteGroup], member: &str) -> String {
    groups
        .iter()
        .find(|group| group.activity_ids.iter().any(|id| id == member))
        .map(|group| group.group_id.clone())
        .unwrap_or_else(|| panic!("no group holds {member}"))
}

/// Scenario: the cutover's detect regroups over a library holding a newly
/// stored activity, commits the new route, and the run stops before its apply.
/// The athlete names the new route, and another activity is stored.
///
/// Expected behaviour: the foreground regroup keeps the committed route on its
/// ground and its name with it, and mints a fresh id for the newcomer.
#[test]
fn a_cutover_that_stops_after_its_detect_leaves_the_engine_on_the_committed_groups() {
    let _serial_state = crate::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let known = with_persistent_engine(|e| {
        let known: std::collections::HashSet<String> =
            e.get_groups().iter().map(|g| g.group_id.clone()).collect();
        e.add_activity("t".into(), track_at(47.0), "Ride".into())
            .expect("arrival");
        known
    })
    .unwrap();

    let detecting_checks = AtomicUsize::new(0);
    let outcome = veloqrs::persistence::cutover::run_cutover_with(&|phase| {
        phase == "detecting" && detecting_checks.fetch_add(1, Ordering::SeqCst) == 1
    })
    .expect("cutover");
    assert!(matches!(outcome, CutoverOutcome::Cancelled));

    let db = rusqlite::Connection::open(&path).expect("open");
    let committed: String = db
        .query_row(
            "SELECT id FROM route_groups WHERE activity_ids LIKE '%\"t\"%'",
            [],
            |row| row.get(0),
        )
        .expect("the detect committed a route for the arrival");
    assert!(!known.contains(&committed));

    let groups = with_persistent_engine(|e| {
        e.set_route_name(&committed, Some("Hill loop")).unwrap();
        e.add_activity("k".into(), track_at(48.0), "Ride".into())
            .expect("arrival");
        e.get_groups().to_vec()
    })
    .unwrap();

    assert_eq!(route_of(&groups, "t"), committed);
    assert_ne!(route_of(&groups, "k"), committed);
    let ids: std::collections::HashSet<&str> = groups.iter().map(|g| g.group_id.as_str()).collect();
    assert_eq!(ids.len(), groups.len(), "no id may repeat");
    let named = groups
        .iter()
        .find(|g| g.group_id == committed)
        .and_then(|g| g.custom_name.as_deref());
    assert_eq!(named, Some("Hill loop"));
}

/// Scenario: a section the athlete named in an older build, whose row name the
/// open-time upgrade moved onto a named intent and cleared.
/// Expected behaviour: the archive keeps the athlete's name, read from the
/// intent, rather than recording a null.
#[test]
fn the_archive_keeps_a_name_that_lives_on_its_intent() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    let auto_id = with_persistent_engine(|e| e.get_sections()[0].id.clone()).unwrap();
    let db = rusqlite::Connection::open(&path).expect("open");
    db.execute(
        "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
         SELECT 'ni_bf_' || id, 'named', '[]', datetime('now'), 'Ridge climb', sport_type
         FROM sections WHERE id = ?",
        [&auto_id],
    )
    .expect("named intent");
    db.execute("UPDATE sections SET name = NULL WHERE id = ?", [&auto_id])
        .expect("clear the row name");

    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().expect("cutover"),
        CutoverOutcome::Completed(_)
    ));

    let details: String = db
        .query_row(
            "SELECT details FROM section_history
             WHERE section_id = ? AND kind = 'archived'",
            [&auto_id],
            |row| row.get(0),
        )
        .expect("archived row");
    let details: serde_json::Value = serde_json::from_str(&details).expect("details json");
    assert_eq!(details["name"], "Ridge climb");
}

fn job_runs() -> Vec<veloqrs::FfiJobRun> {
    veloqrs::objects::error::with_reader(veloqrs::persistence::job_runs::job_runs)
        .expect("a reader")
        .expect("runs read")
}

fn cutover_run() -> Option<veloqrs::FfiJobRun> {
    job_runs().into_iter().find(|run| run.job == "cutover")
}

/// Scenario: a rebuild completes on the synthetic library, and the app is
/// closed and opened again before anyone looks.
///
/// Expected behaviour: the last run reads complete with the diff's counts,
/// the same after the reopen, and the rebuild is not also recorded as a
/// detection run.
#[test]
fn a_completed_rebuild_records_its_last_run_with_the_diffs_counts() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);
    assert!(cutover_run().is_none(), "nothing has run yet");

    veloqrs::persistence::cutover::run_cutover().expect("cutover");
    let diff = veloqrs::ffi::get_cutover_diff().expect("diff should be stored");

    let run = cutover_run().expect("the rebuild recorded its run");
    assert_eq!(run.outcome, "complete");
    assert_eq!(run.handled, diff.counts.proposed);
    assert_eq!(run.added, diff.counts.new);
    assert_eq!(run.changed, diff.counts.changed);
    assert_eq!(run.retired, diff.counts.gone);
    assert_eq!(run.failed, 0);
    assert!(run.finished_at > 0.0);

    let detection = job_runs().iter().any(|run| run.job == "detection");
    assert!(!detection, "a rebuild is not a detection run");

    let again = veloqrs::persistence::cutover::run_cutover().unwrap();
    assert_eq!(again, CutoverOutcome::NotOwed);
    assert_eq!(
        cutover_run().expect("a not-owed run leaves it").finished_at,
        run.finished_at,
        "a run with nothing owed records nothing"
    );
}

/// Scenario: the athlete stops a rebuild part way.
///
/// Expected behaviour: the last run reads stopped.
#[test]
fn a_stopped_rebuild_records_stopped() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_older_build_engine(&path);

    let outcome = veloqrs::persistence::cutover::run_cutover_with(&|phase| phase == "detecting")
        .expect("cutover");
    assert_eq!(outcome, CutoverOutcome::Cancelled);

    let run = cutover_run().expect("the stopped rebuild recorded its run");
    assert_eq!(run.outcome, "stopped");
    assert_eq!((run.added, run.changed, run.retired), (0, 0, 0));
}
