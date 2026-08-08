//! Upgrade from the previous schema version, and the one upgrade that cannot
//! succeed.
//!
//! Scenario: a user launches a build whose `SCHEMA_VERSION` is one ahead of
//! the database on disk. Two shapes matter.
//!
//! 1. A clean previous-version database. Migration 12 runs, and every row the
//!    user cares about is still there afterwards with the same values. A
//!    migration that returns `Ok` while quietly emptying a table would pass a
//!    "did it error" check and fail this one.
//!
//! 2. An interrupted pre-0.3.0 beta database, where some of migration 12's
//!    `ALTER TABLE ... ADD COLUMN` statements already landed but the migration
//!    was never recorded as applied. `012_v030.sql` is not idempotent, so
//!    re-running it raises a duplicate-column error. That is known and
//!    accepted: the correct behaviour is the quarantine failover, not a clean
//!    upgrade. The user pays a resync, never a bricked engine.
//!
//! `persistent_engine_init` writes the process-global `PERSISTENT_ENGINE`, so
//! the quarantine test runs in this file's own process, the same arrangement
//! `tests/engine_init_failover.rs` relies on.

use rusqlite::{Connection, params};
use rusqlite_migration::{M, Migrations};
use std::fs;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;

/// The migration set as it stood before migration 12, matching a database
/// written by the last release on the previous schema version.
fn previous_version_migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../src/migrations/001_initial_schema.sql")),
        M::up(include_str!("../src/migrations/002_unified_sections.sql")),
        M::up(include_str!("../src/migrations/003_drop_section_names.sql")),
        M::up(include_str!(
            "../src/migrations/004_extend_activity_metrics.sql"
        )),
        M::up(include_str!(
            "../src/migrations/005_profile_and_settings.sql"
        )),
        M::up(include_str!(
            "../src/migrations/006_processed_activities.sql"
        )),
        M::up(include_str!(
            "../src/migrations/007_cache_section_performances.sql"
        )),
        M::up(include_str!(
            "../src/migrations/008_cache_all_performance_metrics.sql"
        )),
        M::up(include_str!(
            "../src/migrations/009_section_bounds_cache.sql"
        )),
        M::up(include_str!(
            "../src/migrations/010_route_groups_activity_count.sql"
        )),
        M::up(include_str!("../src/migrations/011_pace_history.sql")),
    ])
}

/// The migration set one version behind the current one, matching a database
/// written by the last release before the wellness body column.
fn one_behind_migrations() -> Migrations<'static> {
    let mut set = vec![
        M::up(include_str!("../src/migrations/001_initial_schema.sql")),
        M::up(include_str!("../src/migrations/002_unified_sections.sql")),
        M::up(include_str!("../src/migrations/003_drop_section_names.sql")),
        M::up(include_str!(
            "../src/migrations/004_extend_activity_metrics.sql"
        )),
        M::up(include_str!(
            "../src/migrations/005_profile_and_settings.sql"
        )),
        M::up(include_str!(
            "../src/migrations/006_processed_activities.sql"
        )),
        M::up(include_str!(
            "../src/migrations/007_cache_section_performances.sql"
        )),
        M::up(include_str!(
            "../src/migrations/008_cache_all_performance_metrics.sql"
        )),
        M::up(include_str!(
            "../src/migrations/009_section_bounds_cache.sql"
        )),
        M::up(include_str!(
            "../src/migrations/010_route_groups_activity_count.sql"
        )),
        M::up(include_str!("../src/migrations/011_pace_history.sql")),
    ];
    set.push(M::up(include_str!("../src/migrations/012_v030.sql")));
    Migrations::new(set)
}

const ACTIVITY_ID: &str = "i2200001";
const SECOND_ACTIVITY_ID: &str = "i2200002";
const ROUTE_ID: &str = "route_bern_loop";
const SECTION_ID: &str = "section_bern_climb";
const SPORT: &str = "Ride";
const ACTIVITY_NAME: &str = "Bern loop";
const SECTION_NAME: &str = "Bern climb";
const START_DATE: i64 = 1_740_000_000;
const LAP_TIME: f64 = 812.5;
const LAP_PACE: f64 = 5.39;
const DISTANCE_METERS: f64 = 4_380.0;

fn polyline_json() -> String {
    let points: Vec<_> = (0..24)
        .map(|i| {
            tracematch::GpsPoint::with_elevation(
                46.9480 + (i as f64) * 0.00006,
                7.4470 + (i as f64) * 0.00011,
                540.0 + (i as f64) * 1.5,
            )
        })
        .collect();
    serde_json::to_string(&points).expect("serialise polyline")
}

/// Write a database at the previous schema version, populated the way a real
/// install would be: two activities, their metrics, a route group, a section
/// and its portions.
fn seed_previous_version_db(path: &Path) -> rusqlite::Result<()> {
    let mut conn = Connection::open(path)?;
    previous_version_migrations()
        .to_latest(&mut conn)
        .expect("apply previous-version migrations");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO schema_info(key, value) VALUES ('schema_version', '7')",
        [],
    )?;

    for (id, name) in [
        (ACTIVITY_ID, ACTIVITY_NAME),
        (SECOND_ACTIVITY_ID, "Bern loop again"),
    ] {
        conn.execute(
            "INSERT INTO activities(id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                    start_date, name, distance_meters, duration_secs)
             VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![
                id,
                SPORT,
                46.9480_f64,
                46.9494_f64,
                7.4470_f64,
                7.4496_f64,
                START_DATE,
                name,
                28_400.0_f64,
                4_215_i64,
            ],
        )?;
        conn.execute(
            "INSERT INTO activity_metrics(
                activity_id, name, date, distance, moving_time, elapsed_time,
                elevation_gain, avg_hr, avg_power, sport_type
             ) VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![
                id,
                name,
                START_DATE,
                28_400.0_f64,
                4_215_i64,
                4_390_i64,
                412.0_f64,
                143.0_f64,
                214.0_f64,
                SPORT,
            ],
        )?;
    }

    conn.execute(
        "INSERT INTO route_groups(id, representative_id, activity_ids, sport_type,
                                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                                  activity_count)
         VALUES (?,?,?,?,?,?,?,?,?)",
        params![
            ROUTE_ID,
            ACTIVITY_ID,
            format!("[\"{}\",\"{}\"]", ACTIVITY_ID, SECOND_ACTIVITY_ID),
            SPORT,
            46.9480_f64,
            46.9494_f64,
            7.4470_f64,
            7.4496_f64,
            2_i64,
        ],
    )?;

    conn.execute(
        "INSERT INTO sections(
            id, section_type, name, sport_type, polyline_json, distance_meters,
            representative_activity_id, version, is_user_defined,
            source_activity_id, start_index, end_index, created_at
         ) VALUES (?, 'custom', ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, datetime('now'))",
        params![
            SECTION_ID,
            SECTION_NAME,
            SPORT,
            polyline_json(),
            DISTANCE_METERS,
            ACTIVITY_ID,
            ACTIVITY_ID,
            10_i64,
            34_i64,
        ],
    )?;

    for id in [ACTIVITY_ID, SECOND_ACTIVITY_ID] {
        conn.execute(
            "INSERT INTO section_activities(
                section_id, activity_id, direction, start_index, end_index,
                distance_meters, lap_time, lap_pace
             ) VALUES (?,?, 'same', ?, ?, ?, ?, ?)",
            params![
                SECTION_ID,
                id,
                10_i64,
                34_i64,
                DISTANCE_METERS,
                LAP_TIME,
                LAP_PACE
            ],
        )?;
    }

    Ok(())
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| {
        row.get(0)
    })
    .unwrap_or_else(|e| panic!("count {}: {}", table, e))
}

fn quarantine_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".corrupt-"))
        .collect()
}

#[test]
fn upgrade_from_previous_version_keeps_the_data() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    seed_previous_version_db(&db_path).expect("seed");

    let engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("open and migrate");
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");

    assert_eq!(count(&conn, "activities"), 2, "activities must survive");
    assert_eq!(
        count(&conn, "activity_metrics"),
        2,
        "activity metrics must survive"
    );
    assert_eq!(count(&conn, "route_groups"), 1, "route group must survive");
    assert_eq!(count(&conn, "sections"), 1, "section must survive");
    assert_eq!(
        count(&conn, "section_activities"),
        2,
        "section portions must survive"
    );

    let (name, sport, distance, start_index, end_index): (String, String, f64, i64, i64) = conn
        .query_row(
            "SELECT name, sport_type, distance_meters, start_index, end_index
             FROM sections WHERE id = ?",
            [SECTION_ID],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .expect("read section");
    assert_eq!(name, SECTION_NAME);
    assert_eq!(sport, SPORT);
    assert_eq!(distance, DISTANCE_METERS);
    assert_eq!((start_index, end_index), (10, 34));

    let (lap_time, lap_pace): (f64, f64) = conn
        .query_row(
            "SELECT lap_time, lap_pace FROM section_activities
             WHERE section_id = ? AND activity_id = ?",
            params![SECTION_ID, ACTIVITY_ID],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read portion");
    assert_eq!(lap_time, LAP_TIME);
    assert_eq!(lap_pace, LAP_PACE);

    let activity_name: String = conn
        .query_row(
            "SELECT name FROM activities WHERE id = ?",
            [ACTIVITY_ID],
            |row| row.get(0),
        )
        .expect("read activity");
    assert_eq!(activity_name, ACTIVITY_NAME);
}

#[test]
fn upgrade_from_previous_version_lands_on_the_current_schema() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    seed_previous_version_db(&db_path).expect("seed");

    let before: i64 = Connection::open(&db_path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();

    let engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("open and migrate");
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");
    let after: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert!(
        after > before,
        "migration must advance user_version, {} -> {}",
        before,
        after
    );

    // Tables and columns migration 12 introduces have to be present, otherwise
    // "the migration ran" means nothing.
    for table in [
        "settings",
        "wellness",
        "exercise_sets",
        "activity_indicators",
    ] {
        assert_eq!(
            count(&conn, table),
            0,
            "{} must exist and start empty",
            table
        );
    }
    conn.query_row(
        "SELECT disabled, superseded_by FROM sections LIMIT 1",
        [],
        |_| Ok(()),
    )
    .expect("section visibility columns must exist");
    conn.query_row(
        "SELECT excluded, avg_hr FROM section_activities LIMIT 1",
        [],
        |_| Ok(()),
    )
    .expect("portion exclusion columns must exist");

    // The JSON-to-blob backfill hooks run after the SQL migrations.
    let polyline_blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT polyline_blob FROM sections WHERE id = ?",
            [SECTION_ID],
            |row| row.get(0),
        )
        .expect("read polyline blob");
    assert!(
        polyline_blob.is_some_and(|b| !b.is_empty()),
        "section polyline must be backfilled into the binary column"
    );

    let ids_blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT activity_ids_blob FROM route_groups WHERE id = ?",
            [ROUTE_ID],
            |row| row.get(0),
        )
        .expect("read activity ids blob");
    assert!(
        ids_blob.is_some_and(|b| !b.is_empty()),
        "route group activity ids must be backfilled into the binary column"
    );
}

#[test]
fn reopening_an_already_current_database_is_a_no_op() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    seed_previous_version_db(&db_path).expect("seed");

    drop(PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("first open"));
    let version_after_first: i64 = Connection::open(&db_path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();

    drop(PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("second open"));

    let conn = Connection::open(&db_path).unwrap();
    let version_after_second: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();

    assert_eq!(version_after_first, version_after_second);
    assert_eq!(count(&conn, "activities"), 2);
    assert_eq!(count(&conn, "sections"), 1);
    assert_eq!(count(&conn, "section_activities"), 2);
}

const WELLNESS_DATE: &str = "2026-07-04";
const WELLNESS_CTL: f64 = 62.4;
const WELLNESS_HRV: f64 = 78.0;

/// A database one version behind, carrying wellness written before the body
/// column existed.
fn seed_one_version_behind_db(path: &Path) -> rusqlite::Result<()> {
    let mut conn = Connection::open(path)?;
    one_behind_migrations()
        .to_latest(&mut conn)
        .expect("apply one-behind migrations");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO schema_info(key, value) VALUES ('schema_version', '12')",
        [],
    )?;

    conn.execute(
        "INSERT INTO wellness(date, ctl, atl, hrv, resting_hr, updated_at)
         VALUES (?,?,?,?,?, strftime('%s','now'))",
        params![
            WELLNESS_DATE,
            WELLNESS_CTL,
            41.0_f64,
            WELLNESS_HRV,
            47.0_f64
        ],
    )?;

    conn.execute(
        "INSERT INTO settings(key, value) VALUES ('athlete_profile', ?)",
        params![r#"{"id":"i1","name":"Demo"}"#],
    )?;

    Ok(())
}

#[test]
fn upgrade_to_the_wellness_body_column_keeps_existing_days() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    seed_one_version_behind_db(&db_path).expect("seed");

    let engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("open and migrate");
    drop(engine);

    let conn = Connection::open(&db_path).expect("reopen");

    let (ctl, hrv, raw): (f64, f64, Option<String>) = conn
        .query_row(
            "SELECT ctl, hrv, raw FROM wellness WHERE date = ?",
            [WELLNESS_DATE],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("read wellness");
    assert_eq!(ctl, WELLNESS_CTL, "typed wellness values must survive");
    assert_eq!(hrv, WELLNESS_HRV);
    assert!(
        raw.is_none(),
        "a day synced before the column existed has no body, and must not be faked"
    );

    let profile: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'athlete_profile'",
            [],
            |row| row.get(0),
        )
        .expect("read athlete profile");
    assert!(profile.contains("\"id\":\"i1\""));
}

#[test]
fn the_wellness_body_column_survives_a_typed_only_rewrite() {
    // The write-through path still upserts typed values without a body. That
    // must not erase a body an earlier sync stored, or the wellness screens
    // lose the fields only the body carries.
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    seed_one_version_behind_db(&db_path).expect("seed");

    let mut engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("migrate");
    let body = r#"{"id":"2026-07-04","ctl":62.4,"hrr":18}"#;

    engine
        .upsert_wellness(&[veloqrs::persistence::wellness::WellnessRow {
            date: WELLNESS_DATE.to_string(),
            ctl: Some(WELLNESS_CTL),
            atl: None,
            ramp_rate: None,
            hrv: Some(WELLNESS_HRV),
            resting_hr: None,
            weight: None,
            sleep_secs: None,
            sleep_score: None,
            soreness: None,
            fatigue: None,
            stress: None,
            mood: None,
            motivation: None,
            raw: Some(body.to_string()),
        }])
        .expect("store body");

    engine
        .upsert_wellness(&[veloqrs::persistence::wellness::WellnessRow {
            date: WELLNESS_DATE.to_string(),
            ctl: Some(70.0),
            atl: None,
            ramp_rate: None,
            hrv: None,
            resting_hr: None,
            weight: None,
            sleep_secs: None,
            sleep_score: None,
            soreness: None,
            fatigue: None,
            stress: None,
            mood: None,
            motivation: None,
            raw: None,
        }])
        .expect("typed-only rewrite");

    let bodies = engine
        .get_wellness_bodies(WELLNESS_DATE, WELLNESS_DATE)
        .expect("read bodies");
    assert_eq!(bodies, vec![body.to_string()]);
}

/// Scenario: a user upgrades with a year of wellness rows the old TypeScript
/// mirror wrote, none of which carry a body.
/// Expected behaviour: the fitness charts still have data to draw before the
/// first sync of the new build lands, including offline.
#[test]
fn rows_without_a_body_are_rebuilt_from_the_typed_columns() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    seed_one_version_behind_db(&db_path).expect("seed");

    let mut engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("migrate");

    engine
        .upsert_wellness(&[veloqrs::persistence::wellness::WellnessRow {
            date: WELLNESS_DATE.to_string(),
            ctl: Some(WELLNESS_CTL),
            atl: Some(48.0),
            ramp_rate: None,
            hrv: Some(WELLNESS_HRV),
            resting_hr: Some(52.0),
            weight: None,
            sleep_secs: Some(27000),
            sleep_score: None,
            soreness: None,
            fatigue: Some(2),
            stress: None,
            mood: None,
            motivation: None,
            raw: None,
        }])
        .expect("store typed-only row");

    let bodies = engine
        .get_wellness_bodies(WELLNESS_DATE, WELLNESS_DATE)
        .expect("read bodies");
    assert_eq!(bodies.len(), 1, "the bodyless row must not be skipped");

    let parsed: serde_json::Value = serde_json::from_str(&bodies[0]).expect("valid json");
    assert_eq!(parsed["id"], WELLNESS_DATE);
    assert_eq!(parsed["ctl"], WELLNESS_CTL);
    assert_eq!(parsed["atl"], 48.0);
    assert_eq!(parsed["hrv"], WELLNESS_HRV);
    assert_eq!(parsed["restingHR"], 52.0);
    assert_eq!(parsed["sleepSecs"], 27000);
    assert_eq!(parsed["fatigue"], 2);

    // Absent values stay absent rather than becoming null, so optional fields
    // read as undefined in TypeScript exactly as they do from a real body.
    assert!(parsed.get("weight").is_none());
    assert!(parsed.get("rampRate").is_none());
}

/// Reproduce the interrupted pre-0.3.0 beta: half of migration 12's column
/// additions are already on disk, but the migration was never recorded.
fn seed_interrupted_beta_db(path: &Path) -> rusqlite::Result<()> {
    seed_previous_version_db(path)?;

    let conn = Connection::open(path)?;
    conn.execute_batch(
        "ALTER TABLE sections ADD COLUMN original_polyline_json TEXT;
         ALTER TABLE sections ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;",
    )?;

    let recorded: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        recorded, 11,
        "the interrupted database must still claim the previous version"
    );

    Ok(())
}

#[test]
fn interrupted_beta_database_is_quarantined_rather_than_upgraded() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("routes.db");
    let db_str = db_path.to_string_lossy().into_owned();
    seed_interrupted_beta_db(&db_path).expect("seed");

    // Migration 012 is not idempotent, so the upgrade cannot succeed.
    assert!(
        PersistentRouteEngine::new(&db_str).is_err(),
        "re-running the non-idempotent migration must fail, not silently pass"
    );

    // The failure is deterministic, so the engine quarantines and starts fresh
    // instead of returning a broken engine on every launch.
    assert!(
        persistent_engine_init(db_str.clone()),
        "init must recover from an unmigratable database"
    );

    let quarantined = quarantine_files(tmp.path());
    assert!(
        quarantined
            .iter()
            .any(|n| n.starts_with("routes.db.corrupt-")),
        "the unmigratable file must be renamed aside, got {:?}",
        quarantined
    );

    // The replacement is a working, empty database. Losing the cache is the
    // accepted cost: it is re-derivable from intervals.icu.
    let conn = Connection::open(&db_path).expect("open replacement");
    assert_eq!(count(&conn, "activities"), 0);
    assert_eq!(count(&conn, "sections"), 0);
    assert_eq!(count(&conn, "route_groups"), 0);
    conn.query_row("SELECT COUNT(*) FROM wellness", [], |_| Ok(()))
        .expect("replacement must be on the current schema");
}
