//! Scenario: a route group's representative has a stored track but no
//! signatures row, so the routes list had no line for its row and the row
//! fetched the representative's whole track to draw a 48 by 36 thumbnail.
//!
//! Expected behaviour: the routes screen read carries the row's line itself,
//! strided to the thumbnail's point budget, in every list order, and a
//! representative with neither a signature nor a track still has no line.

use rusqlite::params;
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::{FfiGroupSort, FfiRoutesScreenQuery};

const TRACK_POINTS: usize = 5_000;
const PREVIEW_POINTS: usize = 64;

fn long_track() -> Vec<GpsPoint> {
    (0..TRACK_POINTS)
        .map(|i| GpsPoint {
            latitude: 46.0 + i as f64 * 0.00001,
            longitude: 7.0 + (i as f64 * 0.01).sin() * 0.001,
            elevation: None,
        })
        .collect()
}

fn insert_group(engine: &PersistentEngine, id: &str, representative: &str) {
    engine
        .db
        .execute(
            "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                       activity_count)
             VALUES (?1, ?2, ?3, 'Ride', 1)",
            params![
                id,
                representative,
                serde_json::to_string(&[representative]).unwrap()
            ],
        )
        .unwrap();
}

fn library() -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    engine
        .add_activity("unsigned".into(), long_track(), "Ride".into())
        .expect("add activity");
    engine
        .db
        .execute("DELETE FROM signatures WHERE activity_id = 'unsigned'", [])
        .unwrap();
    insert_group(&engine, "g-unsigned", "unsigned");
    insert_group(&engine, "g-trackless", "never-synced");
    engine
}

fn row_line(engine: &PersistentEngine, sort: FfiGroupSort, group_id: &str) -> Vec<GpsPoint> {
    let data = engine.get_routes_screen_data(FfiRoutesScreenQuery {
        group_sort: sort,
        group_limit: 10,
        ..Default::default()
    });
    let row = data
        .groups
        .iter()
        .find(|g| g.group_id == group_id)
        .unwrap_or_else(|| panic!("{group_id} missing from the page"));
    crate::persistence::codec::decode_polyline(&row.encoded_polyline).unwrap_or_default()
}

#[test]
fn an_unsigned_representative_rows_with_its_track_strided_to_the_preview() {
    let engine = library();
    let track = long_track();
    for sort in [FfiGroupSort::Activities, FfiGroupSort::Name] {
        let line = row_line(&engine, sort, "g-unsigned");
        assert!(line.len() > 1, "{sort:?}: the row has no line to draw");
        // The stride keeps the closing point, so the budget holds one more.
        assert!(
            line.len() <= PREVIEW_POINTS + 1,
            "{sort:?}: the row carries {} points",
            line.len()
        );
        let first = line.first().unwrap();
        let last = line.last().unwrap();
        assert!((first.latitude - track[0].latitude).abs() < 1e-5);
        assert!((last.latitude - track[TRACK_POINTS - 1].latitude).abs() < 1e-5);
    }
}

#[test]
fn a_representative_with_no_track_rows_with_no_line() {
    let engine = library();
    for sort in [FfiGroupSort::Activities, FfiGroupSort::Name] {
        assert!(row_line(&engine, sort, "g-trackless").is_empty());
    }
}
