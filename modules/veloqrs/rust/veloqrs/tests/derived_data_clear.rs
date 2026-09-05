//! Clear cache empties what the engine can re-derive and keeps what the
//! athlete made. The catalogue side is the detection wipe's own predicate,
//! the activity side is the retention delete's reference exclusion, so a
//! hand-cut, trimmed or disabled section and the stream its geometry is cut
//! from survive by construction.
//!
//! Run: `cargo test --test derived_data_clear -p veloqrs`

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::persistence::codec;
use veloqrs::sections::CreateSectionParams;

fn track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn count(db: &Connection, sql: &str) -> i64 {
    db.query_row(sql, [], |row| row.get(0))
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

fn insert_section(db: &Connection, id: &str, kind: &str, trimmed: bool, disabled: bool) {
    let line = codec::serialize_track_points(&track()[0..12]);
    db.execute(
        "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json, original_polyline_json,
                  polyline_blob, distance_meters, representative_activity_id, rep_start_index,
                  rep_end_index, geometry_source, created_at, is_user_defined, disabled,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?1, ?2, ?1, 'Ride', NULL, ?3, ?4, 1200.0, 'rep', 0, 12, 'exact',
                     '2026-01-01T00:00:00Z', ?5, ?6, 46.0, 46.1, 7.0, 7.1)",
        rusqlite::params![
            id,
            kind,
            trimmed.then_some("[]"),
            line,
            i32::from(kind == "custom"),
            i32::from(disabled),
        ],
    )
    .expect("insert section");
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
             VALUES (?, 'plain', 0, 12)",
        [id],
    )
    .expect("insert member");
}

fn open(path: &Path) -> PersistentEngine {
    PersistentEngine::new(path.to_str().unwrap()).expect("engine")
}

/// Three activities, four sections and every derived cache filled, on disk
/// and ready to open.
///
/// `rep` carries the hand-cut section's geometry, `versioned` a pinned
/// geometry version, `plain` nothing but its own track. All three are older
/// than any sync range.
fn seed(dir: &TempDir) -> PathBuf {
    let path = dir.path().join("clear.db");
    let mut engine = open(&path);
    for id in ["rep", "versioned", "plain"] {
        engine
            .add_activity(id.into(), track(), "Ride".into())
            .expect("add activity");
        engine
            .update_activity_metadata(id, Some(1_600_000_000), None, None, None)
            .expect("metadata");
    }
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: track()[0..30].to_vec(),
            distance_meters: 900.0,
            name: Some("Home climb".into()),
            source_activity_id: Some("rep".into()),
            start_index: Some(0),
            end_index: Some(29),
        })
        .expect("custom section");
    drop(engine);

    let db = Connection::open(&path).expect("raw open");
    db.execute(
        "UPDATE activities SET created_at = strftime('%s', 'now') - 400 * 86400",
        [],
    )
    .expect("age the activities");
    insert_section(&db, "s_auto", "auto", false, false);
    insert_section(&db, "s_trimmed", "auto", true, false);
    insert_section(&db, "s_disabled", "auto", false, true);
    db.execute_batch(
            "INSERT INTO section_geometry
                 (section_id, version, blob, rep_activity_id, rep_start_index, rep_end_index, source)
             VALUES ('s_auto', 1, x'00', 'versioned', 0, 12, 'exact');
             INSERT INTO section_pins (section_id, version) VALUES ('s_auto', 1);
             INSERT INTO section_history (section_id, kind) VALUES ('s_auto', 'pinned');
             INSERT INTO section_intents (id, kind, polyline_json)
                 VALUES ('s_gone', 'deleted', '[]');
             INSERT INTO identity_state (key, blob) VALUES ('registry', x'00');
             INSERT INTO route_names (route_id, custom_name) VALUES ('r1', 'Loop');
             INSERT INTO section_catalogue_archive (token, section_id, sport_type)
                 VALUES ('unified-1', 'archived', 'Ride');
             INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES ('r1', 'plain', 'plain', 'Ride');
             INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES ('r1', 'plain', 1.0, 'same');
             INSERT INTO overlap_cache (activity_a, activity_b, has_overlap, computed_at)
                 VALUES ('rep', 'plain', 1, 0);
             INSERT INTO processed_activities (activity_id) VALUES ('plain');
             INSERT INTO evidence_cache (id, config_digest, folded_ids, cache, updated_at)
                 VALUES (1, 'd', x'00', x'00', 0);",
        )
        .expect("fill the caches");
    path
}

#[test]
fn a_clear_takes_the_auto_sections_and_keeps_the_athletes_own() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    let cleared = engine.clear_derived().expect("clear");

    assert_eq!(cleared.sections_removed, 1);
    let ids: Vec<String> = db
        .prepare("SELECT id FROM sections ORDER BY id")
        .and_then(|mut s| {
            s.query_map([], |r| r.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .expect("ids");
    assert_eq!(
        ids.len(),
        3,
        "custom, trimmed and disabled survive: {ids:?}"
    );
    assert!(!ids.contains(&"s_auto".to_string()));
    assert!(ids.contains(&"s_trimmed".to_string()));
    assert!(ids.contains(&"s_disabled".to_string()));
    let summaries: Vec<String> = engine
        .get_section_summaries()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert!(
        !summaries.contains(&"s_auto".to_string()),
        "the in-memory catalogue still lists the auto section: {summaries:?}"
    );
    assert!(
        summaries.contains(&"s_trimmed".to_string()),
        "{summaries:?}"
    );
}

#[test]
fn a_clear_keeps_every_activity_a_section_references() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    let cleared = engine.clear_derived().expect("clear");

    assert_eq!(cleared.activities_removed, 1);
    assert_eq!(cleared.activities_kept, 2);
    let mut kept = engine.get_activity_ids();
    kept.sort();
    assert_eq!(kept, vec!["rep".to_string(), "versioned".to_string()]);
    assert_eq!(count(&db, "SELECT COUNT(*) FROM gps_tracks"), 2);
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM gps_tracks WHERE activity_id = 'plain'"
        ),
        0,
        "the plain activity's track outlived it"
    );
    let members: Vec<(String, String)> = db
        .prepare("SELECT section_id, activity_id FROM section_activities ORDER BY 1, 2")
        .and_then(|mut s| {
            s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .expect("members");
    assert!(
        members.iter().all(|(_, a)| a != "plain"),
        "a spared section still names the removed activity: {members:?}"
    );
}

#[test]
fn a_clear_leaves_the_record_tables_alone() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    engine.clear_derived().expect("clear");

    for table in [
        "section_geometry",
        "section_pins",
        "section_history",
        "section_intents",
        "identity_state",
        "route_names",
        "section_catalogue_archive",
    ] {
        assert_eq!(
            count(&db, &format!("SELECT COUNT(*) FROM {table}")),
            1,
            "{table} is the athlete's and was touched"
        );
    }
    assert!(
        engine.section_ids_a_mint_must_avoid().contains("s_auto"),
        "the pinned id is still spoken for"
    );
}

#[test]
fn a_clear_empties_the_derived_caches() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    engine.clear_derived().expect("clear");

    for table in [
        "route_groups",
        "activity_matches",
        "overlap_cache",
        "processed_activities",
        "evidence_cache",
    ] {
        assert_eq!(
            count(&db, &format!("SELECT COUNT(*) FROM {table} WHERE 1")),
            0,
            "{table} survived the clear"
        );
    }
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM signatures WHERE activity_id = 'plain'"
        ),
        0,
        "the removed activity's signature survived"
    );
    let stats = engine.stats();
    assert_eq!(stats.group_count, 0);
    assert!(stats.sections_dirty, "the next detect has to re-cut");
}

#[test]
fn a_second_clear_finds_nothing_and_does_not_fail() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    engine.clear_derived().expect("first");
    let again = engine.clear_derived().expect("second");

    assert_eq!(count(&db, "SELECT COUNT(*) FROM activities"), 2);
    assert_eq!(again.sections_removed, 0);
    assert_eq!(again.activities_removed, 0);
    assert_eq!(again.activities_kept, 2);
}

#[test]
fn an_empty_engine_clears_to_zero() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir.path().join("empty.db"));

    let cleared = engine.clear_derived().expect("clear");

    assert_eq!(cleared.sections_removed, 0);
    assert_eq!(cleared.activities_removed, 0);
    assert_eq!(cleared.activities_kept, 0);
}
