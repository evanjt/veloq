//! A section's stored polyline must stay the slice its anchor columns name.
//!
//! Run: `cargo test --test section_anchor_geometry -p veloqrs`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::matching::calculate_route_distance;
use veloqrs::PersistentRouteEngine;
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

fn stored_polyline(engine: &mut PersistentRouteEngine, section_id: &str) -> Vec<GpsPoint> {
    engine
        .get_section_by_id(section_id)
        .expect("section")
        .polyline
}

fn assert_anchor_matches_geometry(engine: &mut PersistentRouteEngine, db: &Connection, id: &str) {
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

    let mut engine = PersistentRouteEngine::new(&path_str).expect("engine");
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

    let mut engine = PersistentRouteEngine::new(&path_str).expect("engine");
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
