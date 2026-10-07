//! Blob-authoritative section geometry.
//!
//! Sections persist the compact blob encoding (`polyline_blob`) as the
//! authoritative geometry. `polyline_json` is NULL on new rows, while legacy
//! JSON-only rows must still decode through the read fallback with no row
//! migration.
//!
//! Run: `cargo test --test section -p veloqrs -- section_blob_authority::`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use tracematch::sections::SectionPortion;
use tracematch::{Direction, GpsPoint};
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    _tmp: TempDir,
    db_path: String,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let db_path = path.to_str().unwrap().to_string();

    let engine = PersistentEngine::new(&db_path).expect("engine new");
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
        let mut engine = PersistentEngine::new(db_path).unwrap();
        // The apply keeps an auto section only while one of its portions
        // belongs to a pooled activity, so the ride the section was cut from
        // has to be in the pool or the save never sees the row this test
        // reads back.
        engine
            .add_activity("act_blob".to_string(), polyline.clone(), "Ride".to_string())
            .expect("add_activity");
        engine
            .update_activity_metadata("act_blob", Some(1_700_000_000), None, None, None)
            .expect("update_activity_metadata");
        let last = (polyline.len() - 1) as u32;
        let section = tracematch::sections::FrequentSection {
            id: "auto_blob_1".to_string(),
            name: None,
            sport_type: "Ride".to_string(),
            polyline: polyline.clone(),
            representative_activity_id: "act_blob".to_string(),
            representative_range: None,
            activity_ids: vec!["act_blob".to_string()],
            activity_portions: vec![SectionPortion {
                activity_id: "act_blob".to_string(),
                start_index: 0,
                end_index: last,
                distance_meters: tracematch::matching::calculate_route_distance(&polyline),
                direction: Direction::Same,
            }],
            visit_count: 1,
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

    let mut engine2 = PersistentEngine::new(db_path).unwrap();
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
    let mut engine2 = PersistentEngine::new(&s.db_path).unwrap();
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
    let mut engine = PersistentEngine::new(&s.db_path).unwrap();
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

/// The line a trim backs up and the footprint an intent keeps, read straight
/// from the row: the quantised blob, and the JSON column beside it.
fn stored_line(db: &Connection, sql: &str, id: &str) -> (Option<Vec<GpsPoint>>, Option<String>) {
    let (blob, json): (Option<Vec<u8>>, Option<String>) = db
        .query_row(sql, params![id], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("stored line row");
    let points = blob.map(|bytes| {
        veloqrs::persistence::codec::deserialize_points(&bytes).expect("a decodable line blob")
    });
    (points, json)
}

fn original_line(db: &Connection, id: &str) -> (Option<Vec<GpsPoint>>, Option<String>) {
    stored_line(
        db,
        "SELECT original_polyline_blob, original_polyline_json FROM sections WHERE id = ?",
        id,
    )
}

fn intent_line(db: &Connection, id: &str) -> (Option<Vec<GpsPoint>>, Option<String>) {
    stored_line(
        db,
        "SELECT polyline_blob, polyline_json FROM section_intents WHERE id = ?",
        id,
    )
}

fn create(engine: &mut PersistentEngine, polyline: &[GpsPoint]) -> String {
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: polyline.to_vec(),
            distance_meters: tracematch::matching::calculate_route_distance(polyline),
            name: None,
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create_section")
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

    let (backup, backup_json) = original_line(&s.raw, "legacy_2");
    assert_close(
        &backup.expect("original line backed up as a blob"),
        &polyline,
    );
    assert!(
        backup_json.is_none(),
        "the backed-up line must not be stored again as JSON, got {backup_json:?}"
    );
    assert!(s.engine.has_original_bounds("legacy_2"));

    let trimmed = s.engine.get_section("legacy_2").expect("get_section");
    assert_close(&trimmed.polyline, &polyline[0..=4]);

    s.engine.reset_section_bounds("legacy_2").expect("reset");
    let restored = s.engine.get_section("legacy_2").expect("get_section");
    assert_close(&restored.polyline, &polyline);
    let (json, has_blob) = row_shape(&s.raw, "legacy_2");
    assert!(has_blob, "reset must write the polyline blob");
    assert!(json.is_none(), "reset must not duplicate geometry as JSON");
    assert_eq!(original_line(&s.raw, "legacy_2"), (None, None));
    assert!(!s.engine.has_original_bounds("legacy_2"));
}

/// A second edit keeps the first backup: the line a reset restores is the one
/// the section had before any edit, not the one before the latest.
#[test]
fn a_second_trim_keeps_the_first_backed_up_line() {
    let mut s = setup();
    let polyline: Vec<GpsPoint> = (0..8)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, 7.0))
        .collect();
    insert_legacy_json_row(&s.raw, "twice", &polyline);

    s.engine.trim_section("twice", 0, 6).expect("first trim");
    s.engine.trim_section("twice", 0, 5).expect("second trim");

    let (backup, _) = original_line(&s.raw, "twice");
    assert_close(&backup.expect("original line backed up"), &polyline);

    s.engine.reset_section_bounds("twice").expect("reset");
    let restored = s.engine.get_section("twice").expect("get_section");
    assert_close(&restored.polyline, &polyline);
}

/// Scenario: a section trimmed by an older build carries its original line
/// as JSON and no blob.
///
/// Expected behaviour: it still counts as edited, so the detection wipe spares
/// it and the reset control shows, and a reset puts the JSON line back.
#[test]
fn a_legacy_json_backup_still_resets() {
    let mut s = setup();
    let polyline = sample_polyline();
    insert_legacy_json_row(&s.raw, "legacy_trim", &polyline[0..=4]);
    s.raw
        .execute(
            "UPDATE sections SET is_user_defined = 1, original_polyline_json = ?
             WHERE id = 'legacy_trim'",
            params![serde_json::to_string(&polyline).unwrap()],
        )
        .expect("give the row a legacy backup");

    assert!(s.engine.has_original_bounds("legacy_trim"));
    s.engine.reset_section_bounds("legacy_trim").expect("reset");

    let restored = s.engine.get_section("legacy_trim").expect("get_section");
    assert_close(&restored.polyline, &polyline);
    assert_eq!(original_line(&s.raw, "legacy_trim"), (None, None));
    assert!(!s.engine.has_original_bounds("legacy_trim"));
}

/// Disabling a blob-only section must capture a real footprint in the
/// suppression intent. An empty footprint would let the corridor re-emerge on
/// the next detect.
#[test]
fn suppression_intent_captures_geometry_from_the_blob() {
    let mut s = setup();
    let polyline = sample_polyline();
    let id = create(&mut s.engine, &polyline);

    s.engine.disable_section(&id).expect("disable_section");

    let (footprint, json) = intent_line(&s.raw, &id);
    assert_close(&footprint.expect("intent footprint as a blob"), &polyline);
    assert!(json.is_none(), "the footprint must not be stored as JSON");
}

#[test]
fn naming_a_detected_section_keeps_its_footprint_as_a_blob() {
    let mut s = setup();
    let polyline = sample_polyline();
    insert_legacy_json_row(&s.raw, "auto_named", &polyline);
    s.raw
        .execute(
            "UPDATE sections SET name = NULL WHERE id = 'auto_named'",
            [],
        )
        .unwrap();

    s.engine
        .set_section_name("auto_named", Some("Riverside climb"))
        .expect("name the section");

    let intent_id: String = s
        .raw
        .query_row(
            "SELECT id FROM section_intents WHERE kind = 'named'",
            [],
            |row| row.get(0),
        )
        .expect("a named intent");
    let (footprint, json) = intent_line(&s.raw, &intent_id);
    assert_close(&footprint.expect("intent footprint as a blob"), &polyline);
    assert!(json.is_none(), "the footprint must not be stored as JSON");

    let corridor = s
        .engine
        .get_named_corridors()
        .into_iter()
        .find(|c| c.intent_id == intent_id)
        .expect("the corridor resolves");
    assert_close(&corridor.footprint, &polyline);
    assert_eq!(corridor.section_id.as_deref(), Some("auto_named"));
}

/// Scenario: a named intent an older build wrote, its footprint as JSON.
///
/// Expected behaviour: the name still resolves onto the section under it.
#[test]
fn a_legacy_json_named_intent_still_resolves() {
    let s = setup();
    let polyline = sample_polyline();
    insert_legacy_json_row(&s.raw, "auto_legacy", &polyline);
    s.raw
        .execute(
            "UPDATE sections SET name = NULL WHERE id = 'auto_legacy'",
            [],
        )
        .unwrap();
    s.raw
        .execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
             VALUES ('ni_old', 'named', ?, '2026-01-01T00:00:00Z', 'Lakeside', 'Ride')",
            params![serde_json::to_string(&polyline).unwrap()],
        )
        .unwrap();

    let corridor = s
        .engine
        .get_named_corridors()
        .into_iter()
        .find(|c| c.intent_id == "ni_old")
        .expect("the legacy corridor resolves");
    assert_close(&corridor.footprint, &polyline);
    assert_eq!(corridor.section_id.as_deref(), Some("auto_legacy"));
}
