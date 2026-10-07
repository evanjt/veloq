//! The merge preview over a pooled connection names the same donor rides the
//! engine method and the merge itself leave out, and writes nothing.

use rusqlite::{Connection, params};
use tracematch::GpsPoint;

use crate::persistence::PersistentEngine;
use crate::persistence::sections::merging::pooled;

fn straight_track(from_lat: f64, to_lat: f64) -> Vec<GpsPoint> {
    let steps = ((to_lat - from_lat) / 0.0001).round() as i32;
    (0..=steps)
        .map(|i| GpsPoint::new(from_lat + f64::from(i) * 0.0001, 7.0))
        .collect()
}

fn insert_section(db: &Connection, id: &str, line: &[GpsPoint]) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version,
                               bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES (?1, 'auto', ?1, 'Ride', ?2, 500.0, 0, 1, ?3, ?4, 7.0, 7.0)",
        params![
            id,
            serde_json::to_string(line).unwrap(),
            line.first().unwrap().latitude,
            line.last().unwrap().latitude
        ],
    )
    .unwrap();
}

fn insert_traversal(db: &Connection, section_id: &str, activity_id: &str) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, excluded)
         VALUES (?1, ?2, 'same', 0, 30, 300.0, 0)",
        params![section_id, activity_id],
    )
    .unwrap();
}

fn pair() -> (PersistentEngine, Connection, tempfile::TempDir) {
    let tmp = tempfile::TempDir::new().unwrap();
    let path = tmp.path().join("test.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    for (id, track) in [
        ("both", straight_track(46.000, 46.009)),
        ("donor_only", straight_track(46.0075, 46.0095)),
    ] {
        engine
            .add_activity(id.to_string(), track, "Ride".to_string())
            .unwrap();
    }
    let reader = Connection::open(&path).unwrap();
    insert_section(&reader, "primary", &straight_track(46.000, 46.006));
    insert_section(&reader, "donor", &straight_track(46.003, 46.009));
    insert_traversal(&reader, "primary", "both");
    insert_traversal(&reader, "donor", "both");
    insert_traversal(&reader, "donor", "donor_only");
    (engine, reader, tmp)
}

#[test]
fn a_pooled_read_names_the_donor_rides_the_engine_method_names() {
    let (engine, reader, _tmp) = pair();

    let pooled_ids: Vec<String> = pooled::merge_preview(&reader, "primary", "donor")
        .unwrap()
        .into_iter()
        .map(|d| d.activity_id)
        .collect();

    let engine_ids: Vec<String> = engine
        .merge_preview("primary", "donor")
        .unwrap()
        .into_iter()
        .map(|d| d.activity_id)
        .collect();
    assert_eq!(pooled_ids, vec!["donor_only".to_string()]);
    assert_eq!(pooled_ids, engine_ids);
}

#[test]
fn a_pooled_preview_with_nothing_to_drop_is_empty_and_writes_nothing() {
    let (_engine, reader, _tmp) = pair();

    let dropped = pooled::merge_preview(&reader, "donor", "primary").unwrap();

    assert!(dropped.is_empty());
    let rows: i64 = reader
        .query_row("SELECT COUNT(*) FROM section_activities", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 3);
}

#[test]
fn a_preview_with_a_missing_primary_line_refuses() {
    let (_engine, reader, _tmp) = pair();

    assert!(pooled::merge_preview(&reader, "missing", "donor").is_err());
}
