//! Elevation metadata on sections.
//!
//! The nullable `elevation_gain_m` / `avg_grade_percent` columns arrive via a
//! pragma-guarded ensure hook, fill lazily through the detect's
//! wipe-and-reinsert, survive an engine reopen, and stay NULL on rows written
//! before the columns existed.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test section_elevation -p veloqrs`

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;

/// A ~2.2 km climbing line: 200 points ~11 m apart, rising 1 m per point,
/// laterally jittered per activity within GPS drift.
fn climbing_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: Some(1000.0 + f64::from(i)),
        })
        .collect()
}

fn unified_engine(path: &std::path::Path) -> PersistentRouteEngine {
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine");
    let mut cfg = engine.get_section_config();
    cfg.min_activities = 3;
    engine.set_section_config(cfg);
    engine
}

fn ingest_climbs(engine: &mut PersistentRouteEngine, count: usize) {
    for i in 0..count {
        let id = format!("climb_{i}");
        engine
            .add_activity(
                id.clone(),
                climbing_track(i as f64 * 0.00002),
                "Ride".into(),
            )
            .expect("add activity");
        // A fortnight apart, clear of the one-week occasion span, so every
        // activity counts as its own occasion.
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
}

fn detect_and_apply(engine: &mut PersistentRouteEngine) {
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply sections");
    engine
        .save_processed_activity_ids(&processed_ids)
        .expect("save processed ids");
}

#[test]
fn a_detect_over_elevated_tracks_fills_the_columns_and_they_survive_reopen() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");

    let (gain, grade) = {
        let mut engine = unified_engine(&path);
        ingest_climbs(&mut engine, 4);
        detect_and_apply(&mut engine);

        let summaries = engine.get_section_summaries();
        assert!(
            !summaries.is_empty(),
            "the climbing pool produced no sections, so the elevation fill has nothing to prove"
        );
        let with_elevation = summaries
            .iter()
            .find(|s| s.elevation_gain_m.is_some())
            .expect("no summary carries elevation after a detect over elevated tracks");
        let gain = with_elevation.elevation_gain_m.unwrap();
        let grade = with_elevation
            .avg_grade_percent
            .expect("gain without grade: the pair fills together");
        assert!(gain > 100.0, "gain {gain} is far below the ~200 m rise");
        assert!(grade > 3.0, "grade {grade}% does not reflect the climb");
        (gain, grade)
    };

    // The raw rows carry the values, not just the in-memory catalogue.
    {
        let conn = Connection::open(&path).expect("open raw db");
        let stored: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sections
                 WHERE elevation_gain_m IS NOT NULL AND avg_grade_percent IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .expect("count elevated rows");
        assert!(stored > 0, "no sections row persisted the elevation pair");
    }

    // Round trip: a fresh engine on the same file reads the same values back.
    let engine = unified_engine(&path);
    let summaries = engine.get_section_summaries();
    let reloaded = summaries
        .iter()
        .find(|s| s.elevation_gain_m.is_some())
        .expect("elevation did not survive the reopen");
    assert!((reloaded.elevation_gain_m.unwrap() - gain).abs() < 1e-6);
    assert!((reloaded.avg_grade_percent.unwrap() - grade).abs() < 1e-6);
}

#[test]
fn rows_written_before_the_columns_existed_read_null() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");

    // Create the schema, then plant a row the way a pre-elevation build
    // would have: no elevation values at all.
    drop(unified_engine(&path));
    {
        let conn = Connection::open(&path).expect("open raw db");
        conn.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('legacy_1', 'auto', 'Ride', '[]', 1200.0)",
            [],
        )
        .expect("insert legacy row");
    }

    let engine = unified_engine(&path);
    let summaries = engine.get_section_summaries();
    let legacy = summaries
        .iter()
        .find(|s| s.id == "legacy_1")
        .expect("legacy row missing from summaries");
    assert_eq!(legacy.elevation_gain_m, None);
    assert_eq!(legacy.avg_grade_percent, None);
}

#[test]
fn the_ensure_hook_is_idempotent_across_reopens() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    drop(unified_engine(&path));
    drop(unified_engine(&path));
    let conn = Connection::open(&path).expect("open raw db");
    let dupes: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sections')
             WHERE name IN ('elevation_gain_m', 'avg_grade_percent')",
            [],
            |row| row.get(0),
        )
        .expect("pragma");
    assert_eq!(
        dupes, 2,
        "the ensure hook must add each column exactly once"
    );
}
