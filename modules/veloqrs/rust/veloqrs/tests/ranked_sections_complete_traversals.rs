//! Scenario: a 2 km section ridden six times in full, plus one row covering
//! 200 m of it. The backfill writes a lap time to any row whose end index is
//! past its start, so the fragment carries one.
//!
//! Expected behaviour: the ranking counts and scores what the indicators and
//! the performances count and score. Both of those skip a `partial` direction
//! and a lap that spans too little of the section, so a section screen showing
//! a 380 s best cannot sit beside an insight card claiming 40 s.
//!
//! Run: `cargo test --test ranked_sections_complete_traversals -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

const SECTION: &str = "sec_ride";
const SECTION_METRES: f64 = 2000.0;
const FULL_LAP_SECS: f64 = 380.0;
/// The fragment: a fifth of the ground in a tenth of the time.
const FRAGMENT_SECS: f64 = 40.0;
const FRAGMENT_METRES: f64 = 200.0;

fn line() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.2,
            longitude: 7.36 + f64::from(i) * 0.000_11,
            elevation: Some(500.0),
        })
        .collect()
}

fn insert_section(db: &Connection, distance_meters: f64) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version, source_activity_id)
         VALUES (?1, 'auto', ?1, 'Ride', ?2, ?3, 0, 1, NULL)",
        params![
            SECTION,
            serde_json::to_string(&line()).expect("encode polyline"),
            distance_meters
        ],
    )
    .expect("insert section");
}

struct Lap {
    activity_id: String,
    date: i64,
    direction: &'static str,
    lap_time: f64,
    distance_meters: f64,
    coverage: Option<f64>,
}

fn insert_lap(db: &Connection, lap: &Lap) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                 start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?1, 20000.0, 3600)",
        params![lap.activity_id, lap.date],
    )
    .expect("insert activity");
    db.execute(
        "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                                       elapsed_time, elevation_gain, sport_type)
         VALUES (?1, ?1, ?2, 20000.0, 3600, 3600, 0.0, 'Ride')",
        params![lap.activity_id, lap.date],
    )
    .expect("insert metrics");
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, coverage, lap_time,
                                         lap_pace, excluded)
         VALUES (?1, ?2, ?3, 0, 40, ?4, ?5, ?6, 3.33, 0)",
        params![
            SECTION,
            lap.activity_id,
            lap.direction,
            lap.distance_meters,
            lap.coverage,
            lap.lap_time
        ],
    )
    .expect("insert traversal");
}

/// Six complete laps, oldest first, and nothing else.
fn six_complete_laps(db: &Connection) {
    let now = chrono::Utc::now().timestamp();
    for t in 0..6 {
        insert_lap(
            db,
            &Lap {
                activity_id: format!("act_full_{t}"),
                date: now - i64::from(t) * 86_400,
                direction: "same",
                lap_time: FULL_LAP_SECS + f64::from(t),
                distance_meters: SECTION_METRES,
                coverage: Some(1.0),
            },
        );
    }
}

fn engine_with(distance_meters: f64) -> (PersistentEngine, Connection, TempDir) {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let db = Connection::open(&path).expect("raw open");
    insert_section(&db, distance_meters);
    six_complete_laps(&db);
    (engine, db, tmp)
}

fn ranked(engine: &PersistentEngine) -> veloqrs::FfiRankedSection {
    engine
        .get_ranked_sections("Ride", 10)
        .into_iter()
        .find(|s| s.section_id == SECTION)
        .expect("the section is ranked")
}

fn ranked_in_batch(engine: &PersistentEngine) -> veloqrs::FfiRankedSection {
    engine
        .get_ranked_sections_by_sports(&["Ride".to_string()], 10)
        .into_iter()
        .find(|e| e.sport_type == "Ride")
        .expect("the sport is answered")
        .sections
        .into_iter()
        .find(|s| s.section_id == SECTION)
        .expect("the section is ranked")
}

/// The fragment as the backfill writes it: `partial`, and short.
fn newest_fragment(db: &Connection) {
    insert_lap(
        db,
        &Lap {
            activity_id: "act_fragment".to_string(),
            date: chrono::Utc::now().timestamp() + 86_400,
            direction: "partial",
            lap_time: FRAGMENT_SECS,
            distance_meters: FRAGMENT_METRES,
            coverage: Some(0.1),
        },
    );
}

#[test]
fn a_partial_row_enters_neither_the_count_nor_the_best() {
    let (engine, db, _tmp) = engine_with(SECTION_METRES);
    let before = ranked(&engine);

    newest_fragment(&db);
    let after = ranked(&engine);

    assert_eq!(after.traversal_count, before.traversal_count);
    assert_eq!(after.best_time_secs, before.best_time_secs);
    assert_eq!(after.trend, before.trend);
}

#[test]
fn the_one_read_that_answers_every_sport_skips_it_too() {
    let (engine, db, _tmp) = engine_with(SECTION_METRES);
    newest_fragment(&db);

    let batch = ranked_in_batch(&engine);
    let one = ranked(&engine);

    assert_eq!(batch.traversal_count, 6);
    assert_eq!(batch.traversal_count, one.traversal_count);
    assert_eq!(batch.best_time_secs, one.best_time_secs);
}

/// A row in the section's own direction that covers a fraction of it. The
/// direction filter alone would let this through, which is why the coverage
/// rule is the other half.
#[test]
fn a_row_covering_too_little_of_the_section_is_skipped_although_its_direction_is_whole() {
    let (engine, db, _tmp) = engine_with(SECTION_METRES);
    let before = ranked(&engine);

    insert_lap(
        &db,
        &Lap {
            activity_id: "act_short".to_string(),
            date: chrono::Utc::now().timestamp() + 86_400,
            direction: "same",
            lap_time: FRAGMENT_SECS,
            distance_meters: FRAGMENT_METRES,
            coverage: Some(0.1),
        },
    );
    let after = ranked(&engine);

    assert_eq!(after.traversal_count, before.traversal_count);
    assert_eq!(after.best_time_secs, before.best_time_secs);
}

/// The coverage column is what the rule reads when it is there, so a row long
/// enough on distance but measured short is still out.
#[test]
fn coverage_outranks_the_distance_fallback() {
    let (engine, db, _tmp) = engine_with(SECTION_METRES);
    let before = ranked(&engine);

    insert_lap(
        &db,
        &Lap {
            activity_id: "act_measured_short".to_string(),
            date: chrono::Utc::now().timestamp() + 86_400,
            direction: "same",
            lap_time: FRAGMENT_SECS,
            distance_meters: SECTION_METRES,
            coverage: Some(0.5),
        },
    );

    assert_eq!(ranked(&engine).best_time_secs, before.best_time_secs);
}

/// A section with no length of its own admits everything, which is what
/// `covers_enough_for_record` does. The column is NOT NULL, so "no length" is
/// zero. The direction filter is the only rule left, so a whole-direction row
/// still counts.
#[test]
fn a_section_with_no_length_still_takes_a_whole_direction_row() {
    let (engine, db, _tmp) = engine_with(0.0);
    let before = ranked(&engine);

    insert_lap(
        &db,
        &Lap {
            activity_id: "act_unmeasured".to_string(),
            date: chrono::Utc::now().timestamp() + 86_400,
            direction: "same",
            lap_time: FRAGMENT_SECS,
            distance_meters: FRAGMENT_METRES,
            coverage: None,
        },
    );
    let after = ranked(&engine);

    assert_eq!(after.traversal_count, before.traversal_count + 1);
    assert_eq!(after.best_time_secs, FRAGMENT_SECS);
}

/// The stale read picks sections whose newest traversal is old. A fragment
/// arriving today must not make a stale section look ridden.
#[test]
fn a_fragment_does_not_make_a_stale_section_look_ridden() {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let db = Connection::open(&path).expect("raw open");
    insert_section(&db, SECTION_METRES);

    let long_ago = chrono::Utc::now().timestamp() - 400 * 86_400;
    for t in 0..6 {
        insert_lap(
            &db,
            &Lap {
                activity_id: format!("act_old_{t}"),
                date: long_ago - i64::from(t) * 86_400,
                direction: "same",
                lap_time: FULL_LAP_SECS + f64::from(t),
                distance_meters: SECTION_METRES,
                coverage: Some(1.0),
            },
        );
    }
    newest_fragment(&db);

    let stale = engine.get_stale_ranked_sections("Ride", 90);

    assert!(
        stale.iter().any(|s| s.section_id == SECTION),
        "the section has not been ridden whole since {long_ago}"
    );
}
