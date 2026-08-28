//! Blob-authoritative section geometry.
//!
//! Sections persist the compact blob encoding (`polyline_blob`) as the
//! authoritative geometry. `polyline_json` is NULL on new rows, while legacy
//! JSON-only rows must still decode through the read fallback with no row
//! migration.
//!
//! Run: `cargo test --test section_blob_authority -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;
use veloqrs::sections::CreateSectionParams;

struct Setup {
    engine: PersistentRouteEngine,
    raw: Connection,
    _tmp: TempDir,
    db_path: String,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let db_path = path.to_str().unwrap().to_string();

    let engine = PersistentRouteEngine::new(&db_path).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");

    Setup {
        engine,
        raw,
        _tmp: tmp,
        db_path,
    }
}

/// Six points ~55 m apart along a meridian, ~275 m total.
fn sample_polyline() -> Vec<GpsPoint> {
    (0..6)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, 7.0))
        .collect()
}

fn row_shape(db: &Connection, id: &str) -> (Option<String>, bool) {
    db.query_row(
        "SELECT polyline_json, polyline_blob IS NOT NULL FROM sections WHERE id = ?",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .expect("section row")
}

fn insert_legacy_json_row(db: &Connection, id: &str, polyline: &[GpsPoint]) {
    let json = serde_json::to_string(polyline).unwrap();
    let distance = tracematch::matching::calculate_route_distance(polyline);
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version,
                               bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES (?1, 'auto', 'Legacy', 'Ride', ?2, ?3, 0, 1, 46.0, 46.01, 7.0, 7.01)",
        params![id, json, distance],
    )
    .expect("insert legacy section");
}

fn assert_close(points: &[GpsPoint], expected: &[GpsPoint]) {
    assert_eq!(points.len(), expected.len(), "polyline length mismatch");
    for (got, want) in points.iter().zip(expected) {
        assert!((got.latitude - want.latitude).abs() < 1e-9);
        assert!((got.longitude - want.longitude).abs() < 1e-9);
    }
}

#[test]
fn create_section_writes_blob_as_authority() {
    let mut s = setup();
    let polyline = sample_polyline();

    let id = s
        .engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: polyline.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            name: Some("Blob test".to_string()),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create_section");

    let (json, has_blob) = row_shape(&s.raw, &id);
    assert!(has_blob, "new section must store the polyline blob");
    assert!(
        json.is_none(),
        "new section must not duplicate geometry as JSON, got {json:?}"
    );

    let section = s.engine.get_section(&id).expect("get_section");
    assert_close(&section.polyline, &polyline);

    let flat = s.engine.get_section_polyline(&id);
    assert_eq!(flat.len(), polyline.len() * 2);
    assert!((flat[0] - 46.0).abs() < 1e-9);
}

/// The detection save path (inside `save_sections_with_events`' transaction)
/// must persist geometry as the blob and leave both legacy JSON columns clear.
#[test]
fn detection_save_writes_blob_as_authority() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("apply.db");
    let db_path = path.to_str().unwrap();
    let polyline = sample_polyline();

    {
        let mut engine = PersistentRouteEngine::new(db_path).unwrap();
        let section = tracematch::sections::FrequentSection {
            id: "auto_blob_1".to_string(),
            name: None,
            sport_type: "Ride".to_string(),
            polyline: polyline.clone(),
            representative_activity_id: String::new(),
            representative_range: None,
            activity_ids: vec![],
            activity_portions: vec![],
            route_ids: vec![],
            visit_count: 0,
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            activity_traces: std::collections::HashMap::new(),
            confidence: 0.9,
            observation_count: 3,
            average_spread: 4.0,
            point_density: vec![3; polyline.len()],
            scale: None,
            is_user_defined: false,
            stability: 1.0,
            elevation_gain_m: None,
            avg_grade_percent: None,
            version: 1,
            updated_at: None,
            created_at: None,
            enrichment: Default::default(),
            rank: None,
            consensus_state: None,
        };
        engine
            .apply_sections(vec![section])
            .expect("apply_sections");
    }

    // The identity registry assigns the durable id, so read the row back
    // rather than assuming the detection-side id survived.
    let raw = Connection::open(&path).unwrap();
    let (id, json, has_blob): (String, Option<String>, bool) = raw
        .query_row(
            "SELECT id, polyline_json, polyline_blob IS NOT NULL FROM sections",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("exactly one saved section");
    assert!(has_blob, "save_sections must store the polyline blob");
    assert!(
        json.is_none(),
        "save_sections must not duplicate geometry as JSON"
    );
    let density_shape: (Option<String>, bool) = raw
        .query_row(
            "SELECT point_density_json, point_density_blob IS NOT NULL FROM sections WHERE id = ?",
            params![id.clone()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(density_shape.0, None, "density JSON must not be written");
    assert!(density_shape.1, "density blob must be written");

    let mut engine2 = PersistentRouteEngine::new(db_path).unwrap();
    engine2.load().unwrap();
    let sections = engine2.get_sections();
    let reloaded = sections
        .iter()
        .find(|s| s.id == id)
        .expect("section reloaded from blob");
    assert_close(&reloaded.polyline, &polyline);
    assert_eq!(reloaded.point_density, vec![3; polyline.len()]);
}

#[test]
fn legacy_json_only_row_still_decodes() {
    let s = setup();
    let polyline = sample_polyline();
    insert_legacy_json_row(&s.raw, "legacy_1", &polyline);

    let (json, has_blob) = row_shape(&s.raw, "legacy_1");
    assert!(!has_blob, "test premise: legacy row has no blob");
    assert!(json.is_some(), "test premise: legacy row keeps real JSON");

    let section = s.engine.get_section("legacy_1").expect("get_section");
    assert_close(&section.polyline, &polyline);

    let flat = s.engine.get_section_polyline("legacy_1");
    assert_eq!(flat.len(), polyline.len() * 2);

    // Full engine reload path (load_sections) must also fall back to JSON.
    drop(s.engine);
    let mut engine2 = PersistentRouteEngine::new(&s.db_path).unwrap();
    engine2.load().unwrap();
    let reloaded = engine2
        .get_sections()
        .iter()
        .find(|sec| sec.id == "legacy_1")
        .cloned()
        .expect("legacy section loads into memory");
    assert_close(&reloaded.polyline, &polyline);
}

/// A row with neither a decodable blob nor usable JSON degrades to an empty
/// polyline and must not abort the catalogue load: one unreadable section
/// cannot cost the user every other one.
#[test]
fn unreadable_row_does_not_abort_the_catalogue_load() {
    let s = setup();
    let polyline = sample_polyline();
    insert_legacy_json_row(&s.raw, "good_1", &polyline);
    insert_legacy_json_row(&s.raw, "broken_1", &polyline);
    s.raw
        .execute(
            "UPDATE sections SET polyline_json = '' WHERE id = 'broken_1'",
            [],
        )
        .expect("blank the geometry");

    drop(s.engine);
    let mut engine = PersistentRouteEngine::new(&s.db_path).unwrap();
    engine
        .load()
        .expect("load must succeed despite the bad row");

    let sections = engine.get_sections();
    let good = sections
        .iter()
        .find(|sec| sec.id == "good_1")
        .expect("the readable section still loads");
    assert_close(&good.polyline, &polyline);
    if let Some(broken) = sections.iter().find(|sec| sec.id == "broken_1") {
        assert!(
            broken.polyline.is_empty(),
            "an undecodable row loads with an empty polyline"
        );
    }
}

#[test]
fn trim_of_legacy_row_backs_up_geometry_and_reset_restores_it() {
    let mut s = setup();
    let polyline = sample_polyline();
    insert_legacy_json_row(&s.raw, "legacy_2", &polyline);

    s.engine.trim_section("legacy_2", 0, 4).expect("trim");

    let (json, has_blob) = row_shape(&s.raw, "legacy_2");
    assert!(has_blob, "trim must write the polyline blob");
    assert!(json.is_none(), "trim must not duplicate geometry as JSON");

    let backup: Option<String> = s
        .raw
        .query_row(
            "SELECT original_polyline_json FROM sections WHERE id = ?",
            params!["legacy_2"],
            |row| row.get(0),
        )
        .unwrap();
    let backup_points: Vec<GpsPoint> =
        serde_json::from_str(&backup.expect("original polyline backed up")).unwrap();
    assert_close(&backup_points, &polyline);

    let trimmed = s.engine.get_section("legacy_2").expect("get_section");
    assert_close(&trimmed.polyline, &polyline[0..=4]);

    s.engine.reset_section_bounds("legacy_2").expect("reset");
    let restored = s.engine.get_section("legacy_2").expect("get_section");
    assert_close(&restored.polyline, &polyline);
    let (json, has_blob) = row_shape(&s.raw, "legacy_2");
    assert!(has_blob, "reset must write the polyline blob");
    assert!(json.is_none(), "reset must not duplicate geometry as JSON");
}

/// Disabling a blob-only section must capture a real footprint in the
/// suppression intent, which keeps its own JSON copy of the hidden ground.
/// An empty footprint would let the corridor re-emerge on the next detect.
#[test]
fn suppression_intent_captures_geometry_from_the_blob() {
    let mut s = setup();
    let polyline = sample_polyline();

    let id = s
        .engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: polyline.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&polyline),
            name: None,
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create_section");

    s.engine.disable_section(&id).expect("disable_section");

    let footprint_json: String = s
        .raw
        .query_row(
            "SELECT polyline_json FROM section_intents WHERE id = ?",
            params![id],
            |row| row.get(0),
        )
        .expect("intent row");
    let footprint: Vec<GpsPoint> = serde_json::from_str(&footprint_json).expect("intent footprint");
    assert_close(&footprint, &polyline);
}
