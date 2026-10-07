//! A restored record that waits for ground lands when a detection run cuts it.
//!
//! A pin and its ledger rows name a section by ground, never by id, so on a
//! fresh library they wait until detection draws a section on that ground.
//! The retry has to happen inside the run's own apply: the athlete never
//! calls it, and a record that only lands when something else asks stays
//! "Waiting for matching ground" for ever.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test -p veloqrs --test detection record_restore_detection`

use std::path::Path;

use rusqlite::Connection;
use serde_json::json;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seeded(path: &std::path::Path) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let mut config = engine.get_section_config();
    config.min_activities = 3;
    engine
        .set_section_config(config)
        .expect("set the section config");
    for i in 0..4 {
        let id = format!("ride_{i}");
        engine
            .add_activity(
                id.clone(),
                line_track(f64::from(i) * 0.00002),
                "Ride".into(),
            )
            .unwrap();
        engine
            .update_activity_metadata(
                &id,
                Some(1_700_000_000 - i64::from(i) * 14 * 86_400),
                None,
                None,
                None,
            )
            .unwrap();
    }
    engine
}

fn detect(engine: &mut PersistentEngine) {
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.unwrap_or_default();
    engine
        .apply_sections_save_with_cache(sections, cache_update)
        .unwrap();
    engine.save_processed_activity_ids(&processed_ids).unwrap();
    engine.apply_sections_finalize();
}

fn section_lines(engine: &PersistentEngine, path: &Path) -> Vec<Vec<GpsPoint>> {
    let ids: Vec<String> = Connection::open(path)
        .unwrap()
        .prepare("SELECT id FROM sections WHERE disabled = 0 ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    ids.iter()
        .map(|id| {
            engine
                .get_section_polyline(id)
                .chunks(2)
                .map(|pair| GpsPoint {
                    latitude: pair[0],
                    longitude: pair[1],
                    elevation: None,
                })
                .collect()
        })
        .collect()
}

#[test]
fn dormant_pin_and_ledger_attach_when_a_detection_run_cuts_their_ground() {
    let dir = TempDir::new().unwrap();
    let scratch_path = dir.path().join("scratch.db");
    let mut scratch = seeded(&scratch_path);
    detect(&mut scratch);
    let ground = section_lines(&scratch, &scratch_path)
        .into_iter()
        .find(|line| line.len() >= 2)
        .expect("the seeded pool detects a section");
    let line = serde_json::to_string(&ground).unwrap();
    let no_triple = json!({"rep_activity_id": null, "rep_start_index": null,
        "rep_end_index": null, "point_count": null, "polyline_json": line});
    let payload = json!({"version": 1, "entries": [
        {"table": "section_pins", "values": {"section_id": "foreign-id", "version": 9},
            "ground": no_triple},
        {"table": "section_history", "values": {"section_id": "foreign-id",
            "at": "2025-01-01 00:00:00", "kind": "recut", "details": "{}",
            "geometry_version": null}, "ground": no_triple}
    ]});

    let path = dir.path().join("restored.db");
    let mut engine = seeded(&path);
    let result = engine.restore_record_json(&payload.to_string()).unwrap();
    assert_eq!((result.placed, result.unplaced), (0, 2));

    detect(&mut engine);

    assert!(engine.unplaced_records().unwrap().is_empty());
    let db = Connection::open(&path).unwrap();
    let pinned: String = db
        .query_row("SELECT section_id FROM section_pins", [], |row| row.get(0))
        .unwrap();
    let live: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE id = ?1 AND disabled = 0",
            [&pinned],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(live, 1);
    let ledger: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM section_history WHERE section_id = ?1 AND kind = 'recut'
                 AND at = '2025-01-01 00:00:00'",
            [&pinned],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ledger, 1);
}
