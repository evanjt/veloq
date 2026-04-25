//! Migration regression test: v0.2.x SQLite → current.
//!
//! Seeds a SQLite file with the schema shipped in 0.2.0 / 0.2.1 / 0.2.2
//! (`SCHEMA_VERSION=7`, migrations 1–11 — byte-identical across the three
//! tags) populated with a realistic custom section, then opens the current
//! `PersistentRouteEngine` against that file. Opening runs the consolidated
//! migration 12 (0.3.0) plus the post-migration Rust backfill hooks in
//! `persistence/schema.rs`.
//!
//! What this guards against
//! ------------------------
//! A migration or a post-migration hook that silently drops, corrupts, or
//! fails to default a field of a custom section authored in 0.2.x. The
//! user-visible contract is the FFI surface: every method the TS app calls
//! for custom sections (`useCustomSections.ts`, `useUnifiedSections.ts`,
//! `useSectionMatches.ts`) must return the same section with intact data.
//!
//! Why not go through the global `PERSISTENT_ENGINE`
//! -------------------------------------------------
//! `SectionManager` methods route through `with_engine(|e| e.foo(...))` which
//! locks the process-global singleton. `cargo test`'s default parallel
//! execution cannot share that safely, and `tests/lock_contention.rs` already
//! sidesteps the singleton for the same reason. We call `PersistentRouteEngine`
//! methods directly — the exact same methods the `with_engine` closures call
//! — and apply the same `FfiFrequentSection::from` / `FfiSection::from`
//! conversions the FFI layer applies. That is the FFI data contract.

use rusqlite::{Connection, params};
use rusqlite_migration::{M, Migrations};
use std::path::Path;
use tempfile::TempDir;
use veloqrs::{FfiFrequentSection, FfiSection, FfiSectionPerformanceResult, PersistentRouteEngine};

// ----------------------------------------------------------------------------
// Seed helpers
// ----------------------------------------------------------------------------

/// Build a 0.2.x-shaped SQLite database at `path`. Applies migrations 1–11
/// (byte-equal to what shipped at tags `0.2.0`, `0.2.1`, `0.2.2`), stamps
/// `schema_info.schema_version = 7`, and writes schema_info / activities rows
/// but no section rows (callers add those).
fn seed_v02x_db(path: &Path) -> rusqlite::Result<()> {
    let mut conn = Connection::open(path)?;

    // These are the same .sql files the current schema pipeline include_str!'s
    // and the ones 0.2.x shipped. The repo treats migrations as append-only,
    // so referencing them by stable path gives us an exact 0.2.x schema with
    // zero fixture drift.
    let v02x = Migrations::new(vec![
        M::up(include_str!("../src/migrations/001_initial_schema.sql")),
        M::up(include_str!("../src/migrations/002_unified_sections.sql")),
        M::up(include_str!("../src/migrations/003_drop_section_names.sql")),
        M::up(include_str!(
            "../src/migrations/004_extend_activity_metrics.sql"
        )),
        M::up(include_str!("../src/migrations/005_profile_and_settings.sql")),
        M::up(include_str!("../src/migrations/006_processed_activities.sql")),
        M::up(include_str!(
            "../src/migrations/007_cache_section_performances.sql"
        )),
        M::up(include_str!(
            "../src/migrations/008_cache_all_performance_metrics.sql"
        )),
        M::up(include_str!("../src/migrations/009_section_bounds_cache.sql")),
        M::up(include_str!(
            "../src/migrations/010_route_groups_activity_count.sql"
        )),
        M::up(include_str!("../src/migrations/011_pace_history.sql")),
    ]);
    v02x.to_latest(&mut conn).expect("apply v0.2.x migrations");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO schema_info(key, value) VALUES ('schema_version', '7')",
        [],
    )?;

    Ok(())
}

/// Generate a deterministic GPS track: `count` points along a line starting
/// near (47.3769, 8.5417) — Zurich, chosen because the repo already uses it
/// in other fixtures. Each step is roughly 10 m east + 1 m elevation gain.
fn sample_gps_points(count: usize) -> Vec<tracematch::GpsPoint> {
    (0..count)
        .map(|i| {
            let lat = 47.3769 + (i as f64) * 0.00005; // ~5.5 m/step north
            let lng = 8.5417 + (i as f64) * 0.0001; // ~7.5 m/step east at this lat
            let ele = 400.0 + (i as f64) * 1.0;
            tracematch::GpsPoint::with_elevation(lat, lng, ele)
        })
        .collect()
}

/// Generate a deterministic time stream: `count` seconds at 1 Hz.
fn sample_times(count: usize) -> Vec<u32> {
    (0..count as u32).collect()
}

/// Insert a minimal activity row matching the 0.2.x schema.
fn insert_activity(
    conn: &Connection,
    id: &str,
    sport: &str,
    points: &[tracematch::GpsPoint],
    start_date: i64,
) -> rusqlite::Result<()> {
    let (min_lat, max_lat, min_lng, max_lng) = bounds_of(points);
    conn.execute(
        "INSERT INTO activities(id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                start_date, name, distance_meters, duration_secs)
         VALUES (?,?,?,?,?,?,?,?,?,?)",
        params![
            id,
            sport,
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            start_date,
            "Seed activity",
            25_000.0_f64,
            3_600_i64,
        ],
    )?;
    Ok(())
}

fn bounds_of(points: &[tracematch::GpsPoint]) -> (f64, f64, f64, f64) {
    let mut min_lat = f64::MAX;
    let mut max_lat = f64::MIN;
    let mut min_lng = f64::MAX;
    let mut max_lng = f64::MIN;
    for p in points {
        if p.latitude < min_lat {
            min_lat = p.latitude;
        }
        if p.latitude > max_lat {
            max_lat = p.latitude;
        }
        if p.longitude < min_lng {
            min_lng = p.longitude;
        }
        if p.longitude > max_lng {
            max_lng = p.longitude;
        }
    }
    (min_lat, max_lat, min_lng, max_lng)
}

fn insert_gps_track(
    conn: &Connection,
    activity_id: &str,
    points: &[tracematch::GpsPoint],
) -> rusqlite::Result<()> {
    // MessagePack — same encoding the engine uses in `store_gps_track`.
    let blob = rmp_serde::to_vec(points)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    conn.execute(
        "INSERT INTO gps_tracks(activity_id, track_data, point_count) VALUES (?,?,?)",
        params![activity_id, blob, points.len() as i64],
    )?;
    Ok(())
}

fn insert_time_stream(
    conn: &Connection,
    activity_id: &str,
    times: &[u32],
) -> rusqlite::Result<()> {
    let blob = rmp_serde::to_vec(times)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    conn.execute(
        "INSERT INTO time_streams(activity_id, times, point_count) VALUES (?,?,?)",
        params![activity_id, blob, times.len() as i64],
    )?;
    Ok(())
}

fn insert_activity_metrics(
    conn: &Connection,
    activity_id: &str,
    sport: &str,
    name: &str,
    date: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO activity_metrics(
            activity_id, name, date, distance, moving_time, elapsed_time,
            elevation_gain, avg_hr, avg_power, sport_type
         ) VALUES (?,?,?,?,?,?,?,?,?,?)",
        params![
            activity_id,
            name,
            date,
            25_000.0_f64,
            3_600_i64,
            3_650_i64,
            120.0_f64,
            Option::<i64>::None, // avg_hr — realistic for a ride with no HR strap
            220_i64,
            sport,
        ],
    )?;
    Ok(())
}

/// Encode a polyline to the same JSON form the Rust side stores in
/// `sections.polyline_json`.
fn encode_polyline_json(points: &[tracematch::GpsPoint]) -> String {
    serde_json::to_string(points).expect("polyline json")
}

#[allow(clippy::too_many_arguments)]
fn insert_custom_section(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    sport: &str,
    polyline_json: &str,
    distance: f64,
    source_activity_id: &str,
    start_index: u32,
    end_index: u32,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sections(
            id, section_type, name, sport_type, polyline_json, distance_meters,
            representative_activity_id, version, is_user_defined,
            source_activity_id, start_index, end_index,
            created_at
         ) VALUES (?, 'custom', ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, datetime('now'))",
        params![
            id,
            name,
            sport,
            polyline_json,
            distance,
            source_activity_id,
            source_activity_id,
            start_index,
            end_index,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_section_portion(
    conn: &Connection,
    section_id: &str,
    activity_id: &str,
    start_index: u32,
    end_index: u32,
    distance_meters: f64,
    lap_time: f64,
    lap_pace: f64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO section_activities(
            section_id, activity_id, direction, start_index, end_index,
            distance_meters, lap_time, lap_pace
         ) VALUES (?, ?, 'same', ?, ?, ?, ?, ?)",
        params![
            section_id,
            activity_id,
            start_index,
            end_index,
            distance_meters,
            lap_time,
            lap_pace,
        ],
    )?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Scenario: "a user on 0.2.2 authored a single custom section on a ride".
// ----------------------------------------------------------------------------

const ACTIVITY_ID: &str = "act_ride_seed_1";
const SECTION_ID: &str = "custom_1700000000000__abcde";
const SECTION_NAME: &str = "Test Climb";
const SOURCE_SPORT: &str = "Ride";
const START_INDEX: u32 = 10;
const END_INDEX: u32 = 80;
const PORTION_DISTANCE: f64 = 8_500.0;
const PORTION_LAP_TIME: f64 = 420.0;
const PORTION_LAP_PACE: f64 = 20.2;
/// 2025-01-01 00:00 UTC
const SEED_ACTIVITY_DATE: i64 = 1_735_689_600;

fn seed_standard_scenario(path: &Path) {
    seed_v02x_db(path).expect("build v0.2.x schema");
    let conn = Connection::open(path).expect("reopen for seed data");

    let full_track = sample_gps_points(120);
    let section_polyline: Vec<tracematch::GpsPoint> =
        full_track[START_INDEX as usize..END_INDEX as usize].to_vec();
    let polyline_json = encode_polyline_json(&section_polyline);

    insert_activity(&conn, ACTIVITY_ID, SOURCE_SPORT, &full_track, SEED_ACTIVITY_DATE)
        .expect("insert activity");
    insert_gps_track(&conn, ACTIVITY_ID, &full_track).expect("insert gps_track");
    insert_time_stream(&conn, ACTIVITY_ID, &sample_times(120)).expect("insert time_stream");
    insert_activity_metrics(&conn, ACTIVITY_ID, SOURCE_SPORT, "Seed Ride", SEED_ACTIVITY_DATE)
        .expect("insert activity_metrics");

    insert_custom_section(
        &conn,
        SECTION_ID,
        Some(SECTION_NAME),
        SOURCE_SPORT,
        &polyline_json,
        PORTION_DISTANCE,
        ACTIVITY_ID,
        START_INDEX,
        END_INDEX,
    )
    .expect("insert custom section");
    insert_section_portion(
        &conn,
        SECTION_ID,
        ACTIVITY_ID,
        START_INDEX,
        END_INDEX,
        PORTION_DISTANCE,
        PORTION_LAP_TIME,
        PORTION_LAP_PACE,
    )
    .expect("insert section_activities");
}

/// Open the current engine (runs migrations 12–25 + post-migration hooks),
/// then load in-memory caches so `get_section_*` methods see seeded data.
fn open_current_engine(path: &Path) -> PersistentRouteEngine {
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.load().expect("load engine state");
    engine
}

// ----------------------------------------------------------------------------
// Test 1 — SQL-level survival of the custom section row.
//
// Asserts against raw SQLite so a future refactor of the FFI types cannot
// mask a schema-level regression.
// ----------------------------------------------------------------------------

#[test]
fn sql_level_custom_section_survives_forward_migration() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);

    // Run migrations + hooks.
    drop(open_current_engine(&path));

    let conn = Connection::open(&path).expect("reopen");

    let schema_version: String = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .expect("schema_version present");
    assert_eq!(schema_version, "12", "schema version should be bumped to 12");

    // rusqlite_migration tracks progress via SQLite's PRAGMA user_version,
    // so applying 12 migrations leaves user_version = 12.
    let pragma_user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("PRAGMA user_version readable");
    assert_eq!(
        pragma_user_version, 12,
        "rusqlite_migration should have advanced PRAGMA user_version to 12"
    );

    // Section row preserved.
    let (section_type, source_activity_id, stored_start, stored_end, name, polyline_json): (
        String,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        String,
    ) = conn
        .query_row(
            "SELECT section_type, source_activity_id, start_index, end_index, name, polyline_json
             FROM sections WHERE id = ?",
            params![SECTION_ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .expect("section row survives");
    assert_eq!(section_type, "custom");
    assert_eq!(source_activity_id.as_deref(), Some(ACTIVITY_ID));
    assert_eq!(stored_start, Some(START_INDEX as i64));
    assert_eq!(stored_end, Some(END_INDEX as i64));
    assert_eq!(name.as_deref(), Some(SECTION_NAME));
    // Polyline JSON is stored verbatim — must be byte-identical.
    let expected_polyline_json =
        encode_polyline_json(&sample_gps_points(120)[START_INDEX as usize..END_INDEX as usize]);
    assert_eq!(polyline_json, expected_polyline_json);

    // New columns added after 0.2.2 default correctly.
    let (disabled, superseded_by, consensus_state_blob): (i64, Option<String>, Option<Vec<u8>>) =
        conn.query_row(
            "SELECT disabled, superseded_by, consensus_state_blob FROM sections WHERE id = ?",
            params![SECTION_ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("new section columns readable");
    assert_eq!(disabled, 0, "disabled must default to 0 on pre-migration rows");
    assert!(superseded_by.is_none(), "superseded_by must default to NULL");
    assert!(
        consensus_state_blob.is_none(),
        "consensus_state_blob must default to NULL on pre-migration custom sections"
    );

    // section_activities preserved and upgraded.
    let (excluded, avg_hr, stored_lap_time): (i64, Option<f64>, Option<f64>) = conn
        .query_row(
            "SELECT excluded, avg_hr, lap_time FROM section_activities
             WHERE section_id = ? AND activity_id = ?",
            params![SECTION_ID, ACTIVITY_ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("section_activities row survives");
    assert_eq!(excluded, 0, "excluded must default to 0");
    assert!(avg_hr.is_none(), "avg_hr backfill is lazy — NULL is acceptable");
    assert_eq!(
        stored_lap_time,
        Some(PORTION_LAP_TIME),
        "pre-existing lap_time must NOT be clobbered by the M7 backfill hook"
    );

    // Perf composite index (M24) present.
    let has_perf_index: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master
             WHERE type='index' AND name='idx_section_activities_perf'",
            [],
            |r| r.get::<_, i64>(0).map(|_| true),
        )
        .unwrap_or(false);
    assert!(has_perf_index, "idx_section_activities_perf must exist after migration 024");
}

// ----------------------------------------------------------------------------
// Test 2 — FFI data contract on the migrated database.
//
// Exercises the full set of read methods the TS app calls for custom
// sections. Assertions are on the `Ffi*` struct shapes returned through the
// same `From` conversions the FFI layer applies.
// ----------------------------------------------------------------------------

#[test]
fn ffi_custom_section_readable_after_migration() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);
    let mut engine = open_current_engine(&path);

    // get_by_id — the single most important call (section detail screen).
    let by_id: Option<FfiFrequentSection> = engine
        .get_section_by_id(SECTION_ID)
        .map(FfiFrequentSection::from);
    let section = by_id.expect("custom section must be readable by id after migration");
    assert_eq!(section.id, SECTION_ID);
    assert_eq!(section.name.as_deref(), Some(SECTION_NAME));
    assert_eq!(section.sport_type, SOURCE_SPORT);
    assert!(
        !section.polyline.is_empty(),
        "polyline must deserialize to ≥1 point"
    );
    assert!(section.is_user_defined, "custom section must report is_user_defined=true");
    assert_eq!(
        section.activity_portions.len(),
        1,
        "single seeded portion must be present"
    );
    let portion = &section.activity_portions[0];
    assert_eq!(portion.activity_id, ACTIVITY_ID);
    assert_eq!(portion.start_index, START_INDEX);
    assert_eq!(portion.end_index, END_INDEX);

    // get_by_type("custom") — Insights / unified sections list.
    let by_type: Vec<FfiSection> = engine
        .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
        .into_iter()
        .map(FfiSection::from)
        .collect();
    assert_eq!(by_type.len(), 1, "exactly one custom section after migration");
    let unified = &by_type[0];
    assert_eq!(unified.id, SECTION_ID);
    assert_eq!(unified.section_type, "custom");
    assert_eq!(
        unified.source_activity_id.as_deref(),
        Some(ACTIVITY_ID),
        "source_activity_id must survive forward migration"
    );
    assert_eq!(unified.start_index, Some(START_INDEX));
    assert_eq!(unified.end_index, Some(END_INDEX));
    assert!(!unified.disabled, "disabled default must surface as false through FFI");
    assert!(unified.superseded_by.is_none(), "superseded_by default must be None");

    // get_for_activity — Activity detail "Sections" tab.
    let for_activity: Vec<FfiSection> = engine
        .get_sections_for_activity(ACTIVITY_ID)
        .into_iter()
        .map(FfiSection::from)
        .collect();
    assert!(
        for_activity.iter().any(|s| s.id == SECTION_ID),
        "custom section must be listed on its source activity"
    );

    // get_summaries — Insights summary row / Routes list.
    let summaries = engine.get_section_summaries_for_sport(SOURCE_SPORT);
    assert!(
        summaries.iter().any(|s| s.id == SECTION_ID),
        "section summary must be present for sport"
    );
    let summary = summaries.iter().find(|s| s.id == SECTION_ID).unwrap();
    assert_eq!(summary.section_type, "custom");
    assert_eq!(summary.name.as_deref(), Some(SECTION_NAME));
    assert!(
        (summary.distance_meters - PORTION_DISTANCE).abs() < 1.0,
        "distance must round-trip through summary"
    );

    // Note: `get_all_section_names` only enumerates auto sections (it reads
    // the in-memory `self.sections` vec, which load_sections populates
    // exclusively with auto rows). Custom section names are read via
    // `get_section_by_id` / `get_sections_by_type`, both verified above.
    // That's the correct app-level behavior, not a migration concern.

    // get_polyline — section detail + maps.
    let flat = engine.get_section_polyline(SECTION_ID);
    assert!(!flat.is_empty(), "polyline must be non-empty after migration");
    assert_eq!(flat.len() % 2, 0, "flat polyline must be pairs of (lat, lng)");

    // get_performances — section detail performance history.
    let perf: FfiSectionPerformanceResult =
        engine.get_section_performances_filtered(SECTION_ID, None).into();
    assert!(
        !perf.records.is_empty(),
        "at least one performance record must be derivable from the seeded portion"
    );
    let best = perf.best_record.expect("best record must be present");
    // best_time is in seconds; the seeded cache value is 420 s.
    assert!(
        (best.best_time - PORTION_LAP_TIME).abs() < 5.0,
        "best_record.best_time must come from the preserved M7 lap_time cache (got {}, seeded {})",
        best.best_time,
        PORTION_LAP_TIME
    );
    assert_eq!(best.activity_id, ACTIVITY_ID);
}

// ----------------------------------------------------------------------------
// Test 3 — new-in-current methods must work on 0.2.x-seeded rows.
//
// These methods post-date 0.2.2 and touch columns that the row predates
// (`disabled`, `superseded_by`, `excluded`, `original_polyline_json`). If a
// migration got the defaults wrong, these operations would panic or no-op.
// ----------------------------------------------------------------------------

#[test]
fn ffi_methods_for_new_columns_work_on_pre_migration_data() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);
    let mut engine = open_current_engine(&path);

    // disable / enable — M20 columns. `get_sections_by_type` filters out
    // disabled sections (VISIBLE_FILTER), so we use `get_all_section_summaries`
    // for the visibility check — the same path `getAllSectionsIncludingHidden`
    // uses on the TS side.
    engine.disable_section(SECTION_ID).expect("disable_section");
    let hidden_summaries = engine.get_all_section_summaries(None);
    let disabled_summary = hidden_summaries
        .iter()
        .find(|s| s.id == SECTION_ID)
        .expect("section still present in all-summaries after disable");
    assert!(
        disabled_summary.disabled,
        "disabled must round-trip through SectionSummary.disabled"
    );
    assert!(
        !engine
            .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
            .iter()
            .any(|s| s.id == SECTION_ID),
        "disabled section must be filtered out of the visible list"
    );

    engine.enable_section(SECTION_ID).expect("enable_section");
    let after_enable: FfiSection = engine
        .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
        .into_iter()
        .map(FfiSection::from)
        .find(|s| s.id == SECTION_ID)
        .expect("section visible again after enable");
    assert!(!after_enable.disabled, "enable must clear disabled");

    // exclude / include — M15 column (`section_activities.excluded`).
    engine
        .exclude_activity_from_section(SECTION_ID, ACTIVITY_ID)
        .expect("exclude_activity_from_section");
    let excluded_ids = engine.get_excluded_activity_ids(SECTION_ID);
    assert_eq!(
        excluded_ids,
        vec![ACTIVITY_ID.to_string()],
        "excluded activity must round-trip"
    );
    engine
        .include_activity_in_section(SECTION_ID, ACTIVITY_ID)
        .expect("include_activity_in_section");
    assert!(
        engine.get_excluded_activity_ids(SECTION_ID).is_empty(),
        "include must clear the excluded flag"
    );

    // set_superseded / clear_superseded — M20 column. Seed a fake auto
    // section to satisfy the FK-ish semantics the set_superseded path expects.
    {
        let conn = Connection::open(&path).expect("reopen for superseded seed");
        conn.execute(
            "INSERT INTO sections(id, section_type, sport_type, polyline_json, distance_meters, version)
             VALUES ('auto_dummy_1', 'auto', ?, '[]', 0, 1)",
            params![SOURCE_SPORT],
        )
        .expect("insert auto placeholder");
    }
    // Reload so the new auto section is visible to engine caches.
    engine.load().expect("reload after auto seed");

    engine
        .set_superseded("auto_dummy_1", SECTION_ID)
        .expect("set_superseded");
    engine
        .clear_superseded(SECTION_ID)
        .expect("clear_superseded");

    // trim / has_original_bounds / reset_bounds — M12 column
    // (`original_polyline_json`).
    assert!(
        !engine.has_original_bounds(SECTION_ID),
        "fresh custom section has no original_polyline_json yet"
    );
    engine
        .trim_section(SECTION_ID, 5, 30)
        .expect("trim_section must succeed on a section whose row predates original_polyline_json");
    assert!(
        engine.has_original_bounds(SECTION_ID),
        "after trim, original_polyline_json must be populated"
    );
    engine
        .reset_section_bounds(SECTION_ID)
        .expect("reset_section_bounds");
    assert!(
        !engine.has_original_bounds(SECTION_ID),
        "reset must clear original_polyline_json"
    );

    // Final: section still retrievable — no state corruption from the sequence.
    let final_section = engine.get_section_by_id(SECTION_ID);
    assert!(
        final_section.is_some(),
        "section must still be retrievable after disable/enable/exclude/include/supersede/trim/reset"
    );
}

// ----------------------------------------------------------------------------
// Test 4 — edge cases that should not panic.
//
// These simulate realistic corrupted/degenerate states from earlier app
// versions. The engine opening and the section FFI surface must tolerate
// them without panicking.
// ----------------------------------------------------------------------------

#[test]
fn ffi_survives_orphan_and_null_edge_cases() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);

    // Add edge-case rows to the already-seeded v0.2.x DB before migrating.
    {
        let conn = Connection::open(&path).expect("reopen for edge-case seed");
        // (1) A section with NULL name — valid in 0.2.x.
        insert_custom_section(
            &conn,
            "custom_1700000000001__nullnm",
            None,
            SOURCE_SPORT,
            &encode_polyline_json(&sample_gps_points(120)[10..30]),
            2_500.0,
            ACTIVITY_ID,
            10,
            30,
        )
        .expect("insert null-name section");
        insert_section_portion(
            &conn,
            "custom_1700000000001__nullnm",
            ACTIVITY_ID,
            10,
            30,
            2_500.0,
            120.0,
            20.0,
        )
        .expect("insert null-name portion");

        // (2) A section with an empty polyline_json ('[]') — degenerate but
        // reachable through older code paths.
        insert_custom_section(
            &conn,
            "custom_1700000000002__empty",
            Some("Empty Polyline"),
            SOURCE_SPORT,
            "[]",
            0.0,
            ACTIVITY_ID,
            0,
            0,
        )
        .expect("insert empty-polyline section");

        // (3) An orphan section_activities row pointing at a non-existent
        // section. Pre-CASCADE app versions could leave one behind, and the
        // migration path must tolerate it. We temporarily disable FK checks
        // on this connection only to reproduce the orphan state (SQLite FK
        // enforcement is per-connection; the engine re-enables it on its own
        // connection during normal reads).
        conn.execute("PRAGMA foreign_keys = OFF", [])
            .expect("disable FKs for orphan seed");
        conn.execute(
            "INSERT INTO section_activities(section_id, activity_id, direction,
                                            start_index, end_index, distance_meters)
             VALUES ('custom_nonexistent_orphan', ?, 'same', 0, 10, 500.0)",
            params![ACTIVITY_ID],
        )
        .expect("insert orphan portion");
    }

    // The engine opening must not panic in the face of these rows.
    let mut engine = open_current_engine(&path);

    // NULL name — FFI returns `name: None`, not a crash.
    let null_name_section = engine
        .get_section_by_id("custom_1700000000001__nullnm")
        .map(FfiFrequentSection::from)
        .expect("null-name section retrievable");
    assert!(null_name_section.name.is_none(), "NULL name must come through as None");

    // Empty polyline — FFI returns empty vec, not a deserialize error.
    let empty_poly = engine
        .get_section_by_id("custom_1700000000002__empty")
        .map(FfiFrequentSection::from)
        .expect("empty-polyline section retrievable");
    assert!(
        empty_poly.polyline.is_empty(),
        "empty polyline_json must deserialize to empty vec"
    );
    let flat = engine.get_section_polyline("custom_1700000000002__empty");
    assert!(flat.is_empty(), "get_section_polyline must not crash on []");

    // Orphan portion — every read path must still return cleanly. Nothing is
    // asserted about the orphan itself; we only assert the healthy section
    // remains fully visible.
    let standard = engine
        .get_section_by_id(SECTION_ID)
        .map(FfiFrequentSection::from)
        .expect("healthy custom section still present alongside orphan");
    assert_eq!(standard.activity_portions.len(), 1);
    let summaries = engine.get_section_summaries_for_sport(SOURCE_SPORT);
    assert!(
        summaries.iter().any(|s| s.id == SECTION_ID),
        "standard summary still present"
    );
    let _ = engine.get_sections_for_activity(ACTIVITY_ID); // must not panic
}
