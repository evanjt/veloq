//! Regression test: match percentages must be non-zero after route grouping.
//!
//! Validates that `recompute_groups()` → `recalculate_match_percentages_from_tracks()`
//! → `save_groups()` produces non-zero `activity_matches.match_percentage` for
//! non-representative group members. Also validates that excluded flags survive
//! the DELETE+INSERT cycle in `save_groups()`.

use rusqlite::params;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;

/// Generate a GPS track along a line with slight lateral jitter.
/// All tracks share the same base route so they group together,
/// but jitter ensures AMD is non-zero.
fn make_track(base_lat: f64, base_lng: f64, points: usize, jitter: f64) -> Vec<GpsPoint> {
    (0..points)
        .map(|i| {
            let frac = i as f64 / points as f64;
            GpsPoint::new(
                base_lat + frac * 0.01 + jitter * (i % 3) as f64 * 0.00001,
                base_lng + frac * 0.01 + jitter * (i % 5) as f64 * 0.00001,
            )
        })
        .collect()
}

fn setup_engine(activity_count: usize) -> (PersistentRouteEngine, TempDir) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let mut engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).unwrap();

    for i in 0..activity_count {
        let id = format!("activity_{}", i);
        let track = make_track(47.0, 7.0, 200, i as f64 * 0.5);
        engine
            .add_activity(id, track, "Ride".to_string())
            .unwrap();
    }

    (engine, dir)
}

#[test]
fn match_percentages_nonzero_after_full_grouping() {
    let (mut engine, dir) = setup_engine(5);

    let groups = engine.get_groups();
    assert!(!groups.is_empty(), "Should produce at least one route group");

    // Read directly from DB to verify persistence (not just in-memory state)
    let db_path = dir.path().join("test.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();

    let mut stmt = conn
        .prepare(
            "SELECT am.route_id, am.activity_id, am.match_percentage, rg.representative_id
             FROM activity_matches am
             JOIN route_groups rg ON am.route_id = rg.id",
        )
        .unwrap();

    let rows: Vec<(String, String, f64, String)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    assert!(!rows.is_empty(), "Should have activity_matches rows");

    let mut nonrep_count = 0;
    let mut nonrep_nonzero = 0;
    for (_route_id, activity_id, match_pct, rep_id) in &rows {
        if *activity_id != *rep_id {
            nonrep_count += 1;
            if *match_pct > 0.0 {
                nonrep_nonzero += 1;
            }
        }
    }

    assert!(
        nonrep_count > 0,
        "Should have non-representative members in groups"
    );
    assert_eq!(
        nonrep_nonzero, nonrep_count,
        "All {} non-representative members should have match_percentage > 0.0, \
         but {} are still zero",
        nonrep_count,
        nonrep_count - nonrep_nonzero,
    );
}

#[test]
fn excluded_flags_preserved_across_recompute() {
    let (mut engine, dir) = setup_engine(5);

    // First grouping
    let groups = engine.get_groups();
    assert!(!groups.is_empty());

    let group_id = groups[0].group_id.clone();
    let rep_id = groups[0].representative_id.clone();
    let non_rep = groups[0]
        .activity_ids
        .iter()
        .find(|id| **id != rep_id)
        .expect("Group should have non-representative members")
        .clone();

    // Exclude an activity
    engine
        .exclude_activity_from_route(&group_id, &non_rep)
        .unwrap();

    // Verify exclusion
    let excluded = engine.get_excluded_route_activity_ids(&group_id);
    assert!(
        excluded.contains(&non_rep),
        "Activity should be excluded before recompute"
    );

    // Add a new activity to force recompute on next get_groups()
    let new_track = make_track(47.0, 7.0, 200, 10.0);
    engine
        .add_activity("activity_new".to_string(), new_track, "Ride".to_string())
        .unwrap();

    // Triggers recompute_groups() → save_groups()
    let _groups = engine.get_groups();

    // Verify excluded flag survived
    let db_path = dir.path().join("test.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();

    let excluded_in_db: bool = conn
        .query_row(
            "SELECT excluded FROM activity_matches WHERE route_id = ? AND activity_id = ?",
            params![group_id, non_rep],
            |row| row.get::<_, i32>(0),
        )
        .map(|v| v == 1)
        .unwrap_or(false);

    assert!(
        excluded_in_db,
        "Excluded flag for {} in group {} should survive save_groups() recompute",
        non_rep, group_id
    );
}
