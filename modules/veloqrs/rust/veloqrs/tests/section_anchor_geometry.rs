//! A section's stored polyline must stay the slice its anchor columns name.
//!
//! Run: `cargo test --test section -p veloqrs -- section_anchor_geometry::`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::matching::calculate_route_distance;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

const ACTIVITY_ID: &str = "act-anchor";

fn straight_track(points: usize) -> Vec<GpsPoint> {
    (0..points)
        .map(|i| GpsPoint::new(46.2 + i as f64 * 0.0001, 7.35))
        .collect()
}

fn stored_anchor(db: &Connection, section_id: &str) -> (String, u32, u32) {
    db.query_row(
        "SELECT source_activity_id, start_index, end_index FROM sections WHERE id = ?",
        params![section_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .expect("anchor columns")
}

fn stored_polyline(engine: &mut PersistentEngine, section_id: &str) -> Vec<GpsPoint> {
    engine
        .get_section_by_id(section_id)
        .expect("section")
        .polyline
}

fn assert_anchor_matches_geometry(engine: &mut PersistentEngine, db: &Connection, id: &str) {
    let (activity_id, start, end) = stored_anchor(db, id);
    let track = engine.get_gps_track(&activity_id).expect("source track");
    let slice = &track[start as usize..=end as usize];
    let polyline = stored_polyline(engine, id);

    assert_eq!(slice.len(), polyline.len(), "anchor range length");
    // Stored tracks are quantised by the point codec, so compare within a centimetre.
    for (a, b) in slice.iter().zip(polyline.iter()) {
        assert!((a.latitude - b.latitude).abs() < 1e-7, "latitude drift");
        assert!((a.longitude - b.longitude).abs() < 1e-7, "longitude drift");
    }
}

#[test]
fn trim_and_expand_keep_the_anchor_matching_the_polyline() {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("anchor.db");
    let path_str = path.to_str().unwrap().to_string();

    let mut engine = PersistentEngine::new(&path_str).expect("engine");
    let track = straight_track(400);
    engine
        .add_activity(ACTIVITY_ID.to_string(), track.clone(), "Ride".to_string())
        .expect("add activity");

    let polyline = track[100..=200].to_vec();
    let section_id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            distance_meters: calculate_route_distance(&polyline),
            polyline,
            name: Some("Anchor".to_string()),
            source_activity_id: Some(ACTIVITY_ID.to_string()),
            start_index: Some(100),
            end_index: Some(200),
        })
        .expect("create section");

    let db = Connection::open(&path).expect("raw open");
    assert_anchor_matches_geometry(&mut engine, &db, &section_id);

    engine.trim_section(&section_id, 10, 60).expect("trim");
    assert_eq!(
        stored_anchor(&db, &section_id),
        (ACTIVITY_ID.to_string(), 110, 160)
    );
    assert_anchor_matches_geometry(&mut engine, &db, &section_id);

    engine
        .expand_section_bounds(&section_id, ACTIVITY_ID, 50, 250)
        .expect("expand");
    assert_eq!(
        stored_anchor(&db, &section_id),
        (ACTIVITY_ID.to_string(), 50, 250)
    );
    assert_anchor_matches_geometry(&mut engine, &db, &section_id);

    engine
        .trim_section(&section_id, 5, 105)
        .expect("trim again");
    assert_eq!(
        stored_anchor(&db, &section_id),
        (ACTIVITY_ID.to_string(), 55, 155)
    );
    assert_anchor_matches_geometry(&mut engine, &db, &section_id);

    engine.reset_section_bounds(&section_id).expect("reset");
    assert_eq!(
        stored_anchor(&db, &section_id),
        (ACTIVITY_ID.to_string(), 100, 200)
    );
    assert_anchor_matches_geometry(&mut engine, &db, &section_id);
}

#[test]
fn expand_rejects_a_range_outside_the_track() {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("anchor_bounds.db");
    let path_str = path.to_str().unwrap().to_string();

    let mut engine = PersistentEngine::new(&path_str).expect("engine");
    let track = straight_track(200);
    engine
        .add_activity(ACTIVITY_ID.to_string(), track.clone(), "Ride".to_string())
        .expect("add activity");

    let polyline = track[10..=60].to_vec();
    let section_id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            distance_meters: calculate_route_distance(&polyline),
            polyline,
            name: Some("Anchor".to_string()),
            source_activity_id: Some(ACTIVITY_ID.to_string()),
            start_index: Some(10),
            end_index: Some(60),
        })
        .expect("create section");

    assert!(
        engine
            .expand_section_bounds(&section_id, ACTIVITY_ID, 0, 200)
            .is_err()
    );
    assert!(
        engine
            .expand_section_bounds(&section_id, "missing-activity", 0, 50)
            .is_err()
    );
}

const OTHER_ACTIVITY_ID: &str = "act-other";

fn stored_reference(
    db: &Connection,
    section_id: &str,
) -> (Option<String>, Option<u32>, Option<u32>, String) {
    db.query_row(
        "SELECT representative_activity_id, rep_start_index, rep_end_index, geometry_source
         FROM sections WHERE id = ?",
        params![section_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("reference columns")
}

/// A custom section cut from `ACTIVITY_ID[100..=200]`, beside a second ride.
fn cut_section(
    name: &str,
) -> (
    TempDir,
    String,
    PersistentEngine,
    Vec<GpsPoint>,
    Vec<GpsPoint>,
) {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join(format!("{name}.db"));
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let track = straight_track(400);
    // The second ride runs the same road at half the point spacing.
    let other: Vec<GpsPoint> = (0..800)
        .map(|i| GpsPoint::new(46.2 + i as f64 * 0.00005, 7.35))
        .collect();
    engine
        .add_activity(ACTIVITY_ID.to_string(), track.clone(), "Ride".to_string())
        .expect("add activity");
    engine
        .add_activity(
            OTHER_ACTIVITY_ID.to_string(),
            other.clone(),
            "Ride".to_string(),
        )
        .expect("add other activity");
    let polyline = track[100..=200].to_vec();
    let section_id = engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            distance_meters: calculate_route_distance(&polyline),
            polyline,
            name: Some(name.to_string()),
            source_activity_id: Some(ACTIVITY_ID.to_string()),
            start_index: Some(100),
            end_index: Some(200),
        })
        .expect("create section");
    (tmp, section_id, engine, track, other)
}

/// The line a reader gets once the cached blob is gone: only the reference
/// triple is left to rebuild from.
fn line_with_blob_cleared(
    engine: PersistentEngine,
    tmp: &TempDir,
    name: &str,
    section_id: &str,
) -> Vec<GpsPoint> {
    drop(engine);
    let path = tmp.path().join(format!("{name}.db"));
    let db = Connection::open(&path).expect("raw open");
    db.execute(
        "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL WHERE id = ?",
        params![section_id],
    )
    .expect("clear the blob");
    let mut reopened = PersistentEngine::new(path.to_str().unwrap()).expect("reopen");
    reopened.load().expect("load");
    stored_polyline(&mut reopened, section_id)
}

fn assert_same_line(want: &[GpsPoint], got: &[GpsPoint]) {
    assert_eq!(want.len(), got.len(), "line length");
    for (a, b) in want.iter().zip(got) {
        assert!((a.latitude - b.latitude).abs() < 1e-7, "latitude drift");
        assert!((a.longitude - b.longitude).abs() < 1e-7, "longitude drift");
    }
}

#[test]
fn trim_moves_the_reference_triple_with_the_line() {
    let (tmp, id, mut engine, track, _) = cut_section("trim_triple");
    engine.trim_section(&id, 10, 60).expect("trim");

    let db = Connection::open(tmp.path().join("trim_triple.db")).expect("raw open");
    assert_eq!(
        stored_reference(&db, &id),
        (
            Some(ACTIVITY_ID.to_string()),
            Some(110),
            Some(161),
            "exact".to_string()
        )
    );
    let line = line_with_blob_cleared(engine, &tmp, "trim_triple", &id);
    assert_same_line(&track[110..=160], &line);
}

#[test]
fn expand_onto_another_ride_moves_the_reference_triple() {
    let (tmp, id, mut engine, _, other) = cut_section("expand_triple");
    engine
        .expand_section_bounds(&id, OTHER_ACTIVITY_ID, 80, 440)
        .expect("expand");

    let db = Connection::open(tmp.path().join("expand_triple.db")).expect("raw open");
    assert_eq!(
        stored_reference(&db, &id),
        (
            Some(OTHER_ACTIVITY_ID.to_string()),
            Some(80),
            Some(441),
            "exact".to_string()
        )
    );
    let line = line_with_blob_cleared(engine, &tmp, "expand_triple", &id);
    assert_same_line(&other[80..=440], &line);
}

#[test]
fn reset_bounds_puts_the_reference_triple_back() {
    let (tmp, id, mut engine, track, _) = cut_section("reset_triple");
    engine.trim_section(&id, 10, 60).expect("trim");
    engine
        .expand_section_bounds(&id, OTHER_ACTIVITY_ID, 80, 440)
        .expect("expand");
    engine.reset_section_bounds(&id).expect("reset");

    let db = Connection::open(tmp.path().join("reset_triple.db")).expect("raw open");
    assert_eq!(
        stored_reference(&db, &id),
        (
            Some(ACTIVITY_ID.to_string()),
            Some(100),
            Some(201),
            "exact".to_string()
        )
    );
    let line = line_with_blob_cleared(engine, &tmp, "reset_triple", &id);
    assert_same_line(&track[100..=200], &line);
}

#[test]
fn set_then_reset_reference_keeps_the_line_rebuildable() {
    let (tmp, id, mut engine, track, _) = cut_section("reference_triple");
    engine
        .set_section_reference(&id, OTHER_ACTIVITY_ID)
        .expect("set reference");
    engine
        .reset_section_reference(&id)
        .expect("reset reference");

    let db = Connection::open(tmp.path().join("reference_triple.db")).expect("raw open");
    assert_eq!(
        stored_reference(&db, &id),
        (
            Some(ACTIVITY_ID.to_string()),
            Some(100),
            Some(201),
            "exact".to_string()
        )
    );
    let line = line_with_blob_cleared(engine, &tmp, "reference_triple", &id);
    assert_same_line(&track[100..=200], &line);
}

#[test]
fn trim_of_a_line_with_no_triple_leaves_no_triple() {
    let (tmp, id, mut engine, _, _) = cut_section("no_triple");
    let db = Connection::open(tmp.path().join("no_triple.db")).expect("raw open");
    db.execute(
        "UPDATE sections SET rep_start_index = NULL, rep_end_index = NULL,
                geometry_source = 'consensus' WHERE id = ?",
        params![id],
    )
    .expect("drop the triple");
    engine.trim_section(&id, 10, 60).expect("trim");

    assert_eq!(
        stored_reference(&db, &id).1..=stored_reference(&db, &id).2,
        None..=None
    );
    assert_eq!(stored_reference(&db, &id).3, "consensus");
}
