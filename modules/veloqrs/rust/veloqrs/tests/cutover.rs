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

/// A full reset drops the catalogue, so it must drop the token and config that
/// describe it. Otherwise the next athlete inherits a spent cutover and a
/// detector they cannot change.
#[test]
fn clear_drops_the_cutover_token_and_config() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    veloqrs::persistence::cutover::run_cutover().expect("cutover");
    with_persistent_engine(|e| e.clear().expect("clear")).unwrap();

    let leftovers: i64 = {
        let db = rusqlite::Connection::open(&path).expect("open");
        db.query_row(
            "SELECT COUNT(*) FROM settings
             WHERE key IN ('__detector_cutover', '__detector_cutover_diff',
                           '__section_config_json')",
            [],
            |row| row.get(0),
        )
        .expect("count")
    };
    assert_eq!(leftovers, 0, "cutover state outlived the reset");
}

/// The diff is the change card's whole content. Ids are minted by the identity
/// registry, so a filter keyed on any id prefix silently empties the live side
/// and reports the entire catalogue as lost.
#[test]
fn the_diff_sees_the_catalogue_the_cut_produced() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

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

/// A corridor section's line is a verbatim slice of one real track, so it owes
/// a range that re-slices to it. The opposite claim sat in a comment for months
/// while the field was hardcoded to None, because nothing asserted it. This is
/// what lets the pre-cutover catalogue be stored as a reference.
#[test]
fn a_corridor_section_records_the_range_it_was_sliced_from() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

    let rows: Vec<(
        String,
        Option<String>,
        Option<u32>,
        Option<u32>,
        Option<String>,
    )> = {
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
    assert!(!rows.is_empty(), "the corridor detect produced no sections");

    let mut checked = 0;
    for (id, rep, start, end, source) in &rows {
        assert_eq!(
            source.as_deref(),
            Some("exact"),
            "corridor section {id} was stored without a usable reference"
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
            "corridor section {id} does not re-slice to the line it drew"
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
/// Unified extents disagree with its Corridor ones adopts the new line in one
/// step instead of carrying frozen. A frozen carry keeps the averaged Corridor
/// polyline and its NULL reference alive under a Unified label, which is the
/// one thing the migration exists to prevent.
///
/// This asserts the invariant, not the fix: the synthetic seed's two cuts agree
/// on extents, so it adopts either way and passes with the arm removed. The
/// measurement that made the arm necessary is in `corpus_migration.rs`, where a
/// real 1,201-activity library carried seven frozen. Only a corpus reproduces
/// the disagreement, so only a corpus can guard it.
#[test]
fn no_section_keeps_its_corridor_geometry_across_the_cutover() {
    let _serial = serial();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_corridor_engine(&path);

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
