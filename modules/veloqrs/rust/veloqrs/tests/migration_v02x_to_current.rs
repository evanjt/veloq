//! Upgrade matrix: a released database at version N opened by the current engine.
//!
//! Every released 0.3.0 to 0.3.8 shipped `user_version = 12`, and 0.4.0 carries
//! those installs to 17. The v12 case is therefore the exact path every live user
//! takes, and migration 017 rebuilds `section_activities` with a one-way orphan
//! delete on the way through. A failed migration does not present as a crash: the
//! engine quarantines the file and recreates it, so the user sees a working app
//! with an empty library. Passing on "did not crash" would wave that through, so
//! every test here asserts data survival with original values rather than schema
//! shape alone.
//!
//! Seeds come from `migration_support::seed_at_version`, which applies a prefix of
//! the production `migration_scripts()` list. There is no hand-copied migration
//! list in this file, so a new migration cannot leave the fixtures behind.

mod migration_support;

use migration_support::*;
use rusqlite::types::Value;
use rusqlite::{Connection, params};
use std::collections::HashMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::{FfiSection, FfiSectionPerformanceResult, PersistentRouteEngine};

/// Open the current engine, which runs every pending migration plus the
/// post-migration Rust hooks, then load in-memory caches.
fn open_current_engine(path: &Path) -> PersistentRouteEngine {
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.load().expect("load engine state");
    engine
}

/// Run the migrations without keeping the engine around.
fn upgrade_in_place(path: &Path) {
    drop(open_current_engine(path));
}

/// Run the migrations and the post-migration hooks only. `load` garbage-collects
/// caches that no longer resolve (orphaned route names, for one), which is
/// correct behaviour but not the migration's, so the matrix stops at the schema
/// step to keep the two apart.
fn migrate_only(path: &Path) {
    drop(PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine"));
}

// ----------------------------------------------------------------------------
// Generic probe rows
//
// The matrix test writes one row into every table that exists at the seeded
// version, deriving the table and column lists from sqlite_master at runtime so
// a migration adding a table is covered the day it lands. Every TEXT column gets
// the same sentinel, which makes foreign keys resolve against each other once the
// tables are visited in dependency order.
// ----------------------------------------------------------------------------

const PROBE_TEXT: &str = "mig_probe";
const PROBE_INT: i64 = 7;
const PROBE_REAL: f64 = 1.5;
const PROBE_BLOB: [u8; 2] = [0xAB, 0xCD];

struct Probe {
    table: String,
    columns: Vec<String>,
    values: Vec<Value>,
}

fn table_ddl(conn: &Connection, table: &str) -> String {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|e| panic!("no DDL for table {table}: {e}"))
}

/// Split a CREATE TABLE body into its top-level definitions. Line comments are
/// stripped first because the shipped SQL documents columns inline, and none of
/// the migrations put a `--` inside a string literal.
fn column_definitions(ddl: &str) -> Vec<String> {
    let stripped = ddl
        .lines()
        .map(|line| match line.find("--") {
            Some(i) => &line[..i],
            None => line,
        })
        .collect::<Vec<_>>()
        .join("\n");

    let Some(start) = stripped.find('(') else {
        return Vec::new();
    };
    let Some(end) = stripped.rfind(')') else {
        return Vec::new();
    };

    let mut defs = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut quoted = false;
    for ch in stripped[start + 1..end].chars() {
        match ch {
            '\'' => {
                quoted = !quoted;
                current.push(ch);
            }
            '(' if !quoted => {
                depth += 1;
                current.push(ch);
            }
            ')' if !quoted => {
                depth -= 1;
                current.push(ch);
            }
            ',' if !quoted && depth == 0 => {
                defs.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        defs.push(current.trim().to_string());
    }
    defs
}

/// The first literal of a column's CHECK list, so a constrained column gets a
/// value the constraint accepts instead of the sentinel.
fn check_literal(defs: &[String], column: &str) -> Option<String> {
    let def = defs.iter().find(|d| {
        d.split_whitespace()
            .next()
            .map(|t| {
                t.trim_matches(['"', '`', '[', ']'])
                    .eq_ignore_ascii_case(column)
            })
            .unwrap_or(false)
    })?;
    if !def.to_uppercase().contains("CHECK") {
        return None;
    }
    let start = def.find('\'')? + 1;
    let rest = &def[start..];
    let end = rest.find('\'')?;
    Some(rest[..end].to_string())
}

fn probe_value(decl_type: &str, constrained: Option<String>) -> Value {
    if let Some(literal) = constrained {
        return Value::Text(literal);
    }
    let t = decl_type.to_uppercase();
    if t.contains("INT") {
        Value::Integer(PROBE_INT)
    } else if t.contains("REAL") || t.contains("FLOA") || t.contains("DOUB") {
        Value::Real(PROBE_REAL)
    } else if t.contains("BLOB") {
        Value::Blob(PROBE_BLOB.to_vec())
    } else {
        Value::Text(PROBE_TEXT.to_string())
    }
}

fn declared_types(conn: &Connection, table: &str) -> Vec<(String, String)> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .expect("table_info");
    stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })
    .expect("read table_info")
    .collect::<Result<Vec<_>, _>>()
    .expect("table_info rows")
}

/// Tables ordered so a foreign key's target is always written first.
fn insertion_order(conn: &Connection) -> Vec<String> {
    let tables = tables_at(conn);
    let mut deps: HashMap<String, Vec<String>> = HashMap::new();
    for table in &tables {
        let mut stmt = conn
            .prepare(&format!("PRAGMA foreign_key_list(\"{table}\")"))
            .expect("foreign_key_list");
        let parents: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(2))
            .expect("read foreign keys")
            .filter_map(|r| r.ok())
            .filter(|parent| parent != table && tables.contains(parent))
            .collect();
        deps.insert(table.clone(), parents);
    }

    let mut ordered: Vec<String> = Vec::new();
    while ordered.len() < tables.len() {
        let next: Vec<String> = tables
            .iter()
            .filter(|t| !ordered.contains(*t))
            .filter(|t| deps[*t].iter().all(|p| ordered.contains(p)))
            .cloned()
            .collect();
        assert!(
            !next.is_empty(),
            "foreign keys form a cycle, cannot order {tables:?}"
        );
        ordered.extend(next);
    }
    ordered
}

/// Write one probe row into every table and return what was written.
fn seed_probe_rows(conn: &Connection) -> Vec<Probe> {
    let mut probes = Vec::new();
    for table in insertion_order(conn) {
        let defs = column_definitions(&table_ddl(conn, &table));
        let mut columns = Vec::new();
        let mut values = Vec::new();
        for (name, decl_type) in declared_types(conn, &table) {
            let value = probe_value(&decl_type, check_literal(&defs, &name));
            columns.push(name);
            values.push(value);
        }
        assert!(!columns.is_empty(), "table {table} reported no columns");

        let placeholders = vec!["?"; columns.len()].join(",");
        let quoted = columns
            .iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("INSERT INTO \"{table}\" ({quoted}) VALUES ({placeholders})");
        conn.execute(&sql, rusqlite::params_from_iter(values.iter()))
            .unwrap_or_else(|e| panic!("seed probe row into {table}: {e}"));

        probes.push(Probe {
            table,
            columns,
            values,
        });
    }
    probes
}

/// Migration 012 clears the detection bookkeeping cache on purpose, so a probe
/// row seeded below v12 is expected to be gone. Nothing else may lose a row, and
/// the emptiness is asserted rather than skipped.
fn cleared_on_purpose(table: &str, seeded_at: u32) -> bool {
    table == "processed_activities" && seeded_at < 12
}

fn assert_probe_survived(conn: &Connection, probe: &Probe, seeded_at: u32) {
    let quoted = probe
        .columns
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT {quoted} FROM \"{}\"", probe.table);
    let mut stmt = conn
        .prepare(&sql)
        .unwrap_or_else(|e| panic!("table {} unreadable after upgrade: {e}", probe.table));
    let rows: Vec<Vec<Value>> = stmt
        .query_map([], |row| {
            (0..probe.columns.len())
                .map(|i| row.get::<_, Value>(i))
                .collect::<Result<Vec<_>, _>>()
        })
        .expect("query probe rows")
        .collect::<Result<Vec<_>, _>>()
        .expect("read probe rows");

    assert!(
        rows.contains(&probe.values),
        "v{seeded_at} row in {} did not survive the upgrade with its original values.\n\
         wrote: {:?}\nfound: {:?}",
        probe.table,
        probe.values,
        rows,
    );
}

#[test]
fn every_released_version_upgrades_without_losing_a_row() {
    for seeded_at in 11..=16u32 {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join(format!("v{seeded_at}.db"));

        let probes = {
            let conn = seed_at_version(&path, seeded_at);
            let probes = seed_probe_rows(&conn);
            assert!(
                probes.len() > 10,
                "v{seeded_at} seeded only {} tables, the schema derivation is broken",
                probes.len()
            );
            probes
        };

        migrate_only(&path);

        let conn = Connection::open(&path).expect("reopen after upgrade");
        assert_eq!(
            user_version(&conn),
            latest_version(),
            "a v{seeded_at} database did not reach the current version"
        );

        for probe in &probes {
            if cleared_on_purpose(&probe.table, seeded_at) {
                assert_eq!(
                    row_count(&conn, &probe.table),
                    Some(0),
                    "{} is cleared by design and must be empty, not missing",
                    probe.table
                );
                continue;
            }
            assert_probe_survived(&conn, probe, seeded_at);
        }
    }
}

// ----------------------------------------------------------------------------
// The release-critical case: user_version = 12, what every 0.3.0 to 0.3.8
// install carries.
// ----------------------------------------------------------------------------

const V12_ACTIVITIES: [&str; 3] = ["act_alpha", "act_bravo", "act_charlie"];
const GHOST_ACTIVITIES: [&str; 2] = ["act_deleted_1", "act_deleted_2"];
const AUTO_SECTION: &str = "sec_auto_named";
const CUSTOM_SECTION: &str = "custom_1700000000000__abcde";
const EMPTY_SECTION: &str = "sec_no_visits";
const GHOST_SECTION: &str = "sec_dissolved";
const AUTO_SECTION_NAME: &str = "Chemin des Vignes";
const CUSTOM_SECTION_NAME: &str = "Col de Ma Ferme";

/// Junction rows whose activity row is gone. Migration 017 line 60 deletes these
/// and there is no way back, so the count is pinned exactly.
const ORPHANS_BY_MISSING_ACTIVITY: i64 = 3;
/// Junction rows whose section row is gone, deleted by line 59 of the same filter.
const ORPHANS_BY_MISSING_SECTION: i64 = 1;
const JUNCTION_ROWS_SEEDED: i64 = 9;

fn sample_gps_points(count: usize) -> Vec<tracematch::GpsPoint> {
    (0..count)
        .map(|i| {
            tracematch::GpsPoint::with_elevation(
                47.3769 + (i as f64) * 0.00005,
                8.5417 + (i as f64) * 0.0001,
                400.0 + (i as f64),
            )
        })
        .collect()
}

fn polyline_json(points: &[tracematch::GpsPoint]) -> String {
    serde_json::to_string(points).expect("polyline json")
}

fn seed_v12_library(path: &Path) {
    let conn = seed_at_version(path, 12);

    let track = sample_gps_points(120);
    for (i, id) in V12_ACTIVITIES.iter().enumerate() {
        conn.execute(
            "INSERT INTO activities(id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                    start_date, name, distance_meters, duration_secs)
             VALUES (?1, 'Ride', 47.3, 47.5, 8.5, 8.6, ?2, ?3, ?4, ?5)",
            params![
                id,
                1_735_689_600_i64 + i as i64 * 86_400,
                format!("Ride {i}"),
                25_000.0_f64 + i as f64,
                3_600_i64 + i as i64,
            ],
        )
        .expect("seed activity");
    }

    let poly = polyline_json(&track[10..80]);
    conn.execute(
        "INSERT INTO sections(id, section_type, name, sport_type, polyline_json,
                              distance_meters, version, is_user_defined, created_at)
         VALUES (?1, 'auto', ?2, 'Ride', ?3, 8500.0, 1, 0, '2026-01-01 00:00:00')",
        params![AUTO_SECTION, AUTO_SECTION_NAME, poly],
    )
    .expect("seed auto section");
    conn.execute(
        "INSERT INTO sections(id, section_type, name, sport_type, polyline_json,
                              distance_meters, version, is_user_defined,
                              source_activity_id, start_index, end_index, created_at)
         VALUES (?1, 'custom', ?2, 'Ride', ?3, 4200.0, 1, 1, ?4, 10, 80, '2026-01-02 00:00:00')",
        params![CUSTOM_SECTION, CUSTOM_SECTION_NAME, poly, V12_ACTIVITIES[0]],
    )
    .expect("seed custom section");
    conn.execute(
        "INSERT INTO sections(id, section_type, name, sport_type, polyline_json,
                              distance_meters, version, is_user_defined, created_at)
         VALUES (?1, 'auto', NULL, 'Ride', ?2, 900.0, 1, 0, '2026-01-03 00:00:00')",
        params![EMPTY_SECTION, poly],
    )
    .expect("seed section with no visits");

    let junction = |section: &str, activity: &str, start: i64, lap: f64, excluded: i64| {
        conn.execute(
            "INSERT INTO section_activities(section_id, activity_id, direction, start_index,
                                            end_index, distance_meters, lap_time, lap_pace, excluded)
             VALUES (?1, ?2, 'same', ?3, ?4, 8500.0, ?5, 20.2, ?6)",
            params![section, activity, start, start + 70, lap, excluded],
        )
        .expect("seed junction row");
    };
    junction(AUTO_SECTION, V12_ACTIVITIES[0], 10, 420.0, 0);
    junction(AUTO_SECTION, V12_ACTIVITIES[1], 12, 431.0, 0);
    junction(AUTO_SECTION, V12_ACTIVITIES[2], 14, 999.0, 1);
    junction(CUSTOM_SECTION, V12_ACTIVITIES[0], 10, 210.0, 0);
    junction(CUSTOM_SECTION, V12_ACTIVITIES[1], 12, 215.0, 0);

    // Phantom members an old remove_activity stranded: the pre-017 junction had no
    // activity_id foreign key, so these inserts were permitted at the time.
    junction(AUTO_SECTION, GHOST_ACTIVITIES[0], 20, 500.0, 0);
    junction(AUTO_SECTION, GHOST_ACTIVITIES[1], 22, 501.0, 0);
    junction(CUSTOM_SECTION, GHOST_ACTIVITIES[0], 20, 260.0, 0);

    // A row left behind by a section that is gone. The section_id foreign key
    // existed at v12, so reproducing the stranded state needs it off for this row.
    conn.execute("PRAGMA foreign_keys = OFF", [])
        .expect("relax foreign keys for the stranded row");
    junction(GHOST_SECTION, V12_ACTIVITIES[0], 30, 700.0, 0);
    conn.execute("PRAGMA foreign_keys = ON", [])
        .expect("restore foreign keys");

    conn.execute(
        "INSERT INTO pace_history(date, sport_type, critical_speed, d_prime, r2)
         VALUES (1735689600, 'Run', 4.25, 180.0, 0.94),
                (1738368000, 'Run', 4.31, 182.0, 0.96)",
        [],
    )
    .expect("seed pace history");
    conn.execute(
        "INSERT INTO activity_indicators(activity_id, indicator_type, target_id, target_name,
                                         direction, lap_time, trend, computed_at)
         VALUES (?1, 'section_pr', ?2, ?3, 'same', 420.0, 1, 1735689600)",
        params![V12_ACTIVITIES[0], AUTO_SECTION, AUTO_SECTION_NAME],
    )
    .expect("seed section performance indicator");

    // Drift the denormalised counter deliberately. A 0.3.x install predates the
    // column, but a build with an incomplete trigger set leaves values like these,
    // and ensure_visit_count_denormalisation exists to repair them rather than
    // trust them.
    conn.execute(
        "ALTER TABLE sections ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .expect("add drifted visit_count");
    conn.execute(
        "UPDATE sections SET visit_count = CASE id
             WHEN ?1 THEN 99 WHEN ?2 THEN 0 ELSE 5 END",
        params![AUTO_SECTION, CUSTOM_SECTION],
    )
    .expect("drift visit counts");

    assert_eq!(
        row_count(&conn, "section_activities"),
        Some(JUNCTION_ROWS_SEEDED),
        "the fixture must hold exactly the junction rows the delete count is derived from"
    );
}

#[test]
fn a_v12_release_database_survives_the_upgrade_to_current() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v12_release.db");
    seed_v12_library(&path);

    upgrade_in_place(&path);

    let conn = Connection::open(&path).expect("reopen after upgrade");

    assert_eq!(
        user_version(&conn),
        migration_support::latest_version(),
        "a released 0.3.x database must land on the current schema"
    );
    let stamped: String = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .expect("schema_version stamped");
    assert_eq!(
        stamped,
        migration_support::latest_version().to_string(),
        "app-level schema version must follow"
    );

    assert_eq!(
        row_count(&conn, "activities"),
        Some(V12_ACTIVITIES.len() as i64),
        "activities must not be touched by the upgrade"
    );
    assert_eq!(
        row_count(&conn, "sections"),
        Some(3),
        "sections must not be touched by the upgrade"
    );
    assert_eq!(
        row_count(&conn, "pace_history"),
        Some(2),
        "pace history must survive"
    );

    let (indicator_lap, indicator_name): (f64, String) = conn
        .query_row(
            "SELECT lap_time, target_name FROM activity_indicators
             WHERE activity_id = ?1 AND target_id = ?2",
            params![V12_ACTIVITIES[0], AUTO_SECTION],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("section performance record survives");
    assert_eq!(indicator_lap, 420.0);
    assert_eq!(indicator_name, AUTO_SECTION_NAME);

    // A custom section's name is row data and stays on the row.
    let custom_name: Option<String> = conn
        .query_row(
            "SELECT name FROM sections WHERE id = ?1",
            params![CUSTOM_SECTION],
            |r| r.get(0),
        )
        .expect("custom section survives");
    assert_eq!(
        custom_name.as_deref(),
        Some(CUSTOM_SECTION_NAME),
        "a custom section name must survive the upgrade unchanged"
    );

    // A user name on an auto row is moved to a durable named intent, not lost:
    // a name left on the row dies with the row at the next re-cut. The row keeps
    // whatever generated name the read path gives it, so the check is that the
    // user's name lives in exactly one place, the intent.
    let auto_name: Option<String> = conn
        .query_row(
            "SELECT name FROM sections WHERE id = ?1",
            params![AUTO_SECTION],
            |r| r.get(0),
        )
        .expect("auto section survives");
    assert_ne!(
        auto_name.as_deref(),
        Some(AUTO_SECTION_NAME),
        "the row must not keep a second copy of the name, or an unname would resurface it"
    );
    let promoted: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE kind = 'named' AND name = ?1",
            params![AUTO_SECTION_NAME],
            |r| r.get(0),
        )
        .expect("section_intents readable");
    assert_eq!(
        promoted, 1,
        "the user's section name must survive as exactly one named intent"
    );

    // The junction rebuild keeps every row whose activity and section both remain.
    let survivors: i64 = row_count(&conn, "section_activities").expect("junction table exists");
    assert_eq!(
        survivors,
        JUNCTION_ROWS_SEEDED - ORPHANS_BY_MISSING_ACTIVITY - ORPHANS_BY_MISSING_SECTION,
        "the 017 rebuild kept the wrong number of junction rows"
    );

    let deleted = JUNCTION_ROWS_SEEDED - survivors;
    assert_eq!(
        deleted,
        ORPHANS_BY_MISSING_ACTIVITY + ORPHANS_BY_MISSING_SECTION,
        "017 line 59-60 is a one-way delete, so the number of rows it removes is pinned"
    );

    let ghost_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE activity_id IN (?1, ?2)",
            params![GHOST_ACTIVITIES[0], GHOST_ACTIVITIES[1]],
            |r| r.get(0),
        )
        .expect("count ghost rows");
    assert_eq!(ghost_rows, 0, "orphans by missing activity must be gone");
    let ghost_section_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ?1",
            params![GHOST_SECTION],
            |r| r.get(0),
        )
        .expect("count stranded section rows");
    assert_eq!(
        ghost_section_rows, 0,
        "orphans by missing section must be gone"
    );

    // Survivors keep their performance columns, not merely their keys.
    for (section, activity, start, lap, excluded) in [
        (AUTO_SECTION, V12_ACTIVITIES[0], 10_i64, 420.0_f64, 0_i64),
        (AUTO_SECTION, V12_ACTIVITIES[1], 12, 431.0, 0),
        (AUTO_SECTION, V12_ACTIVITIES[2], 14, 999.0, 1),
        (CUSTOM_SECTION, V12_ACTIVITIES[0], 10, 210.0, 0),
        (CUSTOM_SECTION, V12_ACTIVITIES[1], 12, 215.0, 0),
    ] {
        let (stored_lap, stored_pace, stored_excluded, stored_end): (f64, f64, i64, i64) = conn
            .query_row(
                "SELECT lap_time, lap_pace, excluded, end_index FROM section_activities
                 WHERE section_id = ?1 AND activity_id = ?2 AND start_index = ?3",
                params![section, activity, start],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap_or_else(|e| panic!("{section}/{activity} lost in the rebuild: {e}"));
        assert_eq!(stored_lap, lap, "{section}/{activity} lost its lap time");
        assert_eq!(stored_pace, 20.2, "{section}/{activity} lost its lap pace");
        assert_eq!(
            stored_excluded, excluded,
            "{section}/{activity} lost its exclusion flag"
        );
        assert_eq!(
            stored_end,
            start + 70,
            "{section}/{activity} lost its range"
        );
    }

    // The denormalisation hook repairs the drifted counter instead of trusting it.
    let counts: HashMap<String, i64> = {
        let mut stmt = conn
            .prepare("SELECT id, visit_count FROM sections")
            .expect("visit_count column exists after the upgrade");
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .expect("read visit counts")
            .collect::<Result<_, _>>()
            .expect("visit count rows")
    };
    assert_eq!(
        counts.get(AUTO_SECTION),
        Some(&2),
        "seeded 99, the surviving non-excluded rows are two"
    );
    assert_eq!(
        counts.get(CUSTOM_SECTION),
        Some(&2),
        "seeded 0, the surviving non-excluded rows are two"
    );
    assert_eq!(
        counts.get(EMPTY_SECTION),
        Some(&0),
        "seeded 5, a section with no junction rows visits nothing"
    );

    // The new cascade is live, so a future remove_activity cannot strand a row.
    conn.execute("PRAGMA foreign_keys = ON", [])
        .expect("pragma");
    conn.execute(
        "DELETE FROM activities WHERE id = ?1",
        params![V12_ACTIVITIES[1]],
    )
    .expect("delete activity");
    let after_cascade: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE activity_id = ?1",
            params![V12_ACTIVITIES[1]],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(
        after_cascade, 0,
        "the activity_id cascade the rebuild added did not fire"
    );
}

// ----------------------------------------------------------------------------
// 0.2.x custom sections, read back through the FFI data contract.
//
// 0.2.0 to 0.2.2 shipped `user_version = 11` while stamping
// `schema_info.schema_version = 7`, so the seed reproduces both numbers. The
// assertions go through the same `Ffi*` conversions the FFI layer applies, which
// is the contract the TS app reads.
// ----------------------------------------------------------------------------

const ACTIVITY_ID: &str = "act_ride_seed_1";
const SECTION_ID: &str = "custom_1700000000000__zzzzz";
const SECTION_NAME: &str = "Test Climb";
const SOURCE_SPORT: &str = "Ride";
const START_INDEX: u32 = 10;
const END_INDEX: u32 = 80;
const PORTION_DISTANCE: f64 = 8_500.0;
const PORTION_LAP_TIME: f64 = 420.0;
const PORTION_LAP_PACE: f64 = 20.2;
/// 2025-01-01 00:00 UTC
const SEED_ACTIVITY_DATE: i64 = 1_735_689_600;

/// A database shaped like the one 0.2.2 shipped.
fn seed_v02x_db(path: &Path) -> Connection {
    let conn = seed_at_version(path, 11);
    stamp_app_schema_version(&conn, 7);
    conn
}

fn insert_activity(conn: &Connection, id: &str, sport: &str, start_date: i64) {
    conn.execute(
        "INSERT INTO activities(id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                start_date, name, distance_meters, duration_secs)
         VALUES (?1, ?2, 47.3769, 47.3829, 8.5417, 8.5537, ?3, 'Seed activity', 25000.0, 3600)",
        params![id, sport, start_date],
    )
    .expect("insert activity");
}

fn insert_gps_track(conn: &Connection, activity_id: &str, points: &[tracematch::GpsPoint]) {
    let blob = rmp_serde::to_vec(points).expect("encode track");
    conn.execute(
        "INSERT INTO gps_tracks(activity_id, track_data, point_count) VALUES (?1, ?2, ?3)",
        params![activity_id, blob, points.len() as i64],
    )
    .expect("insert gps_track");
}

fn insert_time_stream(conn: &Connection, activity_id: &str, count: usize) {
    let times: Vec<u32> = (0..count as u32).collect();
    let blob = rmp_serde::to_vec(&times).expect("encode times");
    conn.execute(
        "INSERT INTO time_streams(activity_id, times, point_count) VALUES (?1, ?2, ?3)",
        params![activity_id, blob, count as i64],
    )
    .expect("insert time_stream");
}

fn insert_activity_metrics(conn: &Connection, activity_id: &str, sport: &str, date: i64) {
    conn.execute(
        "INSERT INTO activity_metrics(activity_id, name, date, distance, moving_time,
                                      elapsed_time, elevation_gain, avg_hr, avg_power, sport_type)
         VALUES (?1, 'Seed Ride', ?2, 25000.0, 3600, 3650, 120.0, NULL, 220, ?3)",
        params![activity_id, date, sport],
    )
    .expect("insert activity_metrics");
}

#[allow(clippy::too_many_arguments)]
fn insert_custom_section(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    sport: &str,
    poly: &str,
    distance: f64,
    source_activity_id: &str,
    start_index: u32,
    end_index: u32,
) {
    conn.execute(
        "INSERT INTO sections(
            id, section_type, name, sport_type, polyline_json, distance_meters,
            representative_activity_id, version, is_user_defined,
            source_activity_id, start_index, end_index, created_at
         ) VALUES (?1, 'custom', ?2, ?3, ?4, ?5, ?6, 1, 1, ?6, ?7, ?8, datetime('now'))",
        params![
            id,
            name,
            sport,
            poly,
            distance,
            source_activity_id,
            start_index,
            end_index,
        ],
    )
    .expect("insert custom section");
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
) {
    conn.execute(
        "INSERT INTO section_activities(section_id, activity_id, direction, start_index,
                                        end_index, distance_meters, lap_time, lap_pace)
         VALUES (?1, ?2, 'same', ?3, ?4, ?5, ?6, ?7)",
        params![
            section_id,
            activity_id,
            start_index,
            end_index,
            distance_meters,
            lap_time,
            lap_pace,
        ],
    )
    .expect("insert section_activities");
}

fn seed_standard_scenario(path: &Path) {
    let conn = seed_v02x_db(path);

    let full_track = sample_gps_points(120);
    let poly = polyline_json(&full_track[START_INDEX as usize..END_INDEX as usize]);

    insert_activity(&conn, ACTIVITY_ID, SOURCE_SPORT, SEED_ACTIVITY_DATE);
    insert_gps_track(&conn, ACTIVITY_ID, &full_track);
    insert_time_stream(&conn, ACTIVITY_ID, 120);
    insert_activity_metrics(&conn, ACTIVITY_ID, SOURCE_SPORT, SEED_ACTIVITY_DATE);

    insert_custom_section(
        &conn,
        SECTION_ID,
        Some(SECTION_NAME),
        SOURCE_SPORT,
        &poly,
        PORTION_DISTANCE,
        ACTIVITY_ID,
        START_INDEX,
        END_INDEX,
    );
    insert_section_portion(
        &conn,
        SECTION_ID,
        ACTIVITY_ID,
        START_INDEX,
        END_INDEX,
        PORTION_DISTANCE,
        PORTION_LAP_TIME,
        PORTION_LAP_PACE,
    );
}

#[test]
fn sql_level_custom_section_survives_forward_migration() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);

    upgrade_in_place(&path);

    let conn = Connection::open(&path).expect("reopen");

    let schema_version: String = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .expect("schema_version present");
    assert_eq!(
        schema_version,
        migration_support::latest_version().to_string()
    );
    assert_eq!(user_version(&conn), migration_support::latest_version());

    let (section_type, source_activity_id, stored_start, stored_end, name, stored_poly): (
        String,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        String,
    ) = conn
        .query_row(
            "SELECT section_type, source_activity_id, start_index, end_index, name, polyline_json
             FROM sections WHERE id = ?1",
            params![SECTION_ID],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .expect("section row survives");
    assert_eq!(section_type, "custom");
    assert_eq!(source_activity_id.as_deref(), Some(ACTIVITY_ID));
    assert_eq!(stored_start, Some(START_INDEX as i64));
    assert_eq!(stored_end, Some(END_INDEX as i64));
    assert_eq!(name.as_deref(), Some(SECTION_NAME));
    let expected_poly =
        polyline_json(&sample_gps_points(120)[START_INDEX as usize..END_INDEX as usize]);
    assert_eq!(stored_poly, expected_poly);

    let (disabled, superseded_by, consensus_state_blob): (i64, Option<String>, Option<Vec<u8>>) =
        conn.query_row(
            "SELECT disabled, superseded_by, consensus_state_blob FROM sections WHERE id = ?1",
            params![SECTION_ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("new section columns readable");
    assert_eq!(disabled, 0, "disabled must default to 0 on migrated rows");
    assert!(superseded_by.is_none());
    assert!(consensus_state_blob.is_none());

    let (excluded, avg_hr, stored_lap_time): (i64, Option<f64>, Option<f64>) = conn
        .query_row(
            "SELECT excluded, avg_hr, lap_time FROM section_activities
             WHERE section_id = ?1 AND activity_id = ?2",
            params![SECTION_ID, ACTIVITY_ID],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("section_activities row survives");
    assert_eq!(excluded, 0);
    assert!(avg_hr.is_none(), "avg_hr backfill is lazy");
    assert_eq!(
        stored_lap_time,
        Some(PORTION_LAP_TIME),
        "an existing lap_time must not be clobbered by the backfill hook"
    );

    let has_perf_index: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master
             WHERE type='index' AND name='idx_section_activities_perf'",
            [],
            |r| r.get::<_, i64>(0).map(|_| true),
        )
        .unwrap_or(false);
    assert!(has_perf_index, "the perf composite index must exist");
}

#[test]
fn ffi_custom_section_readable_after_migration() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);
    let mut engine = open_current_engine(&path);

    let section = engine
        .get_section_by_id(SECTION_ID)
        .map(FfiSection::from)
        .expect("custom section must be readable by id after migration");
    assert_eq!(section.id, SECTION_ID);
    assert_eq!(section.name.as_deref(), Some(SECTION_NAME));
    assert_eq!(section.sport_type, SOURCE_SPORT);
    assert!(!section.encoded_polyline.is_empty());
    assert!(section.is_user_defined);
    assert_eq!(section.activity_portions.len(), 1);
    let portion = &section.activity_portions[0];
    assert_eq!(portion.activity_id, ACTIVITY_ID);
    assert_eq!(portion.start_index, START_INDEX);
    assert_eq!(portion.end_index, END_INDEX);

    let by_type: Vec<FfiSection> = engine
        .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
        .into_iter()
        .map(FfiSection::from)
        .collect();
    assert_eq!(by_type.len(), 1);
    let unified = &by_type[0];
    assert_eq!(unified.id, SECTION_ID);
    assert_eq!(unified.section_type, "custom");
    assert_eq!(unified.source_activity_id.as_deref(), Some(ACTIVITY_ID));
    assert_eq!(unified.start_index, Some(START_INDEX));
    assert_eq!(unified.end_index, Some(END_INDEX));
    assert!(!unified.disabled);
    assert!(unified.superseded_by.is_none());

    let for_activity: Vec<FfiSection> = engine
        .get_sections_for_activity(ACTIVITY_ID)
        .into_iter()
        .map(FfiSection::from)
        .collect();
    assert!(for_activity.iter().any(|s| s.id == SECTION_ID));

    let summaries = engine.get_section_summaries_for_sport(SOURCE_SPORT);
    let summary = summaries
        .iter()
        .find(|s| s.id == SECTION_ID)
        .expect("section summary must be present for sport");
    assert_eq!(summary.section_type, "custom");
    assert_eq!(summary.name.as_deref(), Some(SECTION_NAME));
    assert!((summary.distance_meters - PORTION_DISTANCE).abs() < 1.0);

    let flat = engine.get_section_polyline(SECTION_ID);
    assert!(!flat.is_empty());
    assert_eq!(flat.len() % 2, 0, "flat polyline must be pairs of lat, lng");

    let perf: FfiSectionPerformanceResult = engine
        .get_section_performances_filtered(SECTION_ID, None)
        .into();
    assert!(!perf.records.is_empty());
    let best = perf.best_record.expect("best record must be present");
    assert!(
        (best.best_time - PORTION_LAP_TIME).abs() < 5.0,
        "best_time must come from the preserved lap_time cache (got {}, seeded {})",
        best.best_time,
        PORTION_LAP_TIME
    );
    assert_eq!(best.activity_id, ACTIVITY_ID);
}

#[test]
fn ffi_methods_for_new_columns_work_on_pre_migration_data() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);
    let mut engine = open_current_engine(&path);

    engine.disable_section(SECTION_ID).expect("disable_section");
    let disabled_summary = engine
        .get_all_section_summaries(None)
        .into_iter()
        .find(|s| s.id == SECTION_ID)
        .expect("section still present in all-summaries after disable");
    assert!(disabled_summary.disabled);
    assert!(
        !engine
            .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
            .iter()
            .any(|s| s.id == SECTION_ID),
        "a disabled section must be filtered out of the visible list"
    );

    engine.enable_section(SECTION_ID).expect("enable_section");
    let after_enable: FfiSection = engine
        .get_sections_by_type(Some(veloqrs::sections::SectionType::Custom))
        .into_iter()
        .map(FfiSection::from)
        .find(|s| s.id == SECTION_ID)
        .expect("section visible again after enable");
    assert!(!after_enable.disabled);

    engine
        .exclude_activity_from_section(SECTION_ID, ACTIVITY_ID)
        .expect("exclude_activity_from_section");
    assert_eq!(
        engine.get_excluded_activity_ids(SECTION_ID),
        vec![ACTIVITY_ID.to_string()]
    );
    engine
        .include_activity_in_section(SECTION_ID, ACTIVITY_ID)
        .expect("include_activity_in_section");
    assert!(engine.get_excluded_activity_ids(SECTION_ID).is_empty());

    {
        let conn = Connection::open(&path).expect("reopen for superseded seed");
        conn.execute(
            "INSERT INTO sections(id, section_type, sport_type, polyline_json, distance_meters, version)
             VALUES ('auto_dummy_1', 'auto', ?1, '[]', 0, 1)",
            params![SOURCE_SPORT],
        )
        .expect("insert auto placeholder");
    }
    engine.load().expect("reload after auto seed");

    engine
        .set_superseded("auto_dummy_1", SECTION_ID)
        .expect("set_superseded");
    engine
        .clear_superseded(SECTION_ID)
        .expect("clear_superseded");

    assert!(!engine.has_original_bounds(SECTION_ID));
    engine
        .trim_section(SECTION_ID, 5, 30)
        .expect("trim_section must succeed on a row that predates original_polyline_json");
    assert!(engine.has_original_bounds(SECTION_ID));
    engine
        .reset_section_bounds(SECTION_ID)
        .expect("reset_section_bounds");
    assert!(!engine.has_original_bounds(SECTION_ID));

    assert!(
        engine.get_section_by_id(SECTION_ID).is_some(),
        "the section must survive the whole sequence"
    );
}

#[test]
fn ffi_survives_orphan_and_null_edge_cases() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v02x.db");
    seed_standard_scenario(&path);

    {
        let conn = Connection::open(&path).expect("reopen for edge-case seed");
        let track = sample_gps_points(120);

        insert_custom_section(
            &conn,
            "custom_1700000000001__nullnm",
            None,
            SOURCE_SPORT,
            &polyline_json(&track[10..30]),
            2_500.0,
            ACTIVITY_ID,
            10,
            30,
        );
        insert_section_portion(
            &conn,
            "custom_1700000000001__nullnm",
            ACTIVITY_ID,
            10,
            30,
            2_500.0,
            120.0,
            20.0,
        );

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
        );

        // A portion pointing at a section that never existed, which pre-cascade
        // app versions could leave behind.
        conn.execute("PRAGMA foreign_keys = OFF", [])
            .expect("relax foreign keys for the orphan seed");
        conn.execute(
            "INSERT INTO section_activities(section_id, activity_id, direction,
                                            start_index, end_index, distance_meters)
             VALUES ('custom_nonexistent_orphan', ?1, 'same', 0, 10, 500.0)",
            params![ACTIVITY_ID],
        )
        .expect("insert orphan portion");
    }

    let mut engine = open_current_engine(&path);

    let null_name_section = engine
        .get_section_by_id("custom_1700000000001__nullnm")
        .map(FfiSection::from)
        .expect("null-name section retrievable");
    assert!(null_name_section.name.is_none());

    let empty_poly = engine
        .get_section_by_id("custom_1700000000002__empty")
        .map(FfiSection::from)
        .expect("empty-polyline section retrievable");
    assert!(veloqrs::coords::decode(&empty_poly.encoded_polyline).is_empty());
    assert!(
        engine
            .get_section_polyline("custom_1700000000002__empty")
            .is_empty()
    );

    let standard = engine
        .get_section_by_id(SECTION_ID)
        .map(FfiSection::from)
        .expect("healthy custom section still present alongside the orphan");
    assert_eq!(standard.activity_portions.len(), 1);
    assert!(
        engine
            .get_section_summaries_for_sport(SOURCE_SPORT)
            .iter()
            .any(|s| s.id == SECTION_ID)
    );
    let _ = engine.get_sections_for_activity(ACTIVITY_ID);
}

// ----------------------------------------------------------------------------
// Migration 017 on the upgrade path.
// ----------------------------------------------------------------------------

/// The B4 core script, taken from the production list so a renumber cannot leave
/// this test pointed at the wrong file.
fn b4_core_script() -> &'static str {
    let scripts = PersistentRouteEngine::migration_scripts();
    scripts
        .into_iter()
        .find(|s| s.contains("section_activities_rebuild"))
        .expect("the B4 core migration must still be in the shipped list")
}

#[test]
fn migration_017_preserves_user_sections_and_adds_identity_state() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v_pre017.db");

    {
        let conn = seed_v02x_db(&path);
        let track = sample_gps_points(120);
        insert_activity(&conn, "act_ride_1", "Ride", SEED_ACTIVITY_DATE);
        let poly = polyline_json(&track[10..80]);

        conn.execute(
            "INSERT INTO sections(id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at)
             VALUES ('sec_accepted_1', 'auto', 'My Named Climb', 'Ride', ?1, 5000.0, 1, 1, datetime('now'))",
            params![poly],
        )
        .expect("accepted section");

        insert_custom_section(
            &conn,
            "custom_1700000000000__zzzzy",
            Some("My Custom Loop"),
            "Ride",
            &poly,
            5000.0,
            "act_ride_1",
            10,
            80,
        );
    }

    upgrade_in_place(&path);

    let conn = Connection::open(&path).expect("reopen");
    assert!(
        tables_at(&conn).contains(&"identity_state".to_string()),
        "migration 017 did not create identity_state"
    );

    let (accepted_udf, accepted_name): (i64, Option<String>) = conn
        .query_row(
            "SELECT is_user_defined, name FROM sections WHERE id = 'sec_accepted_1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("accepted section survives the migration");
    assert_eq!(accepted_udf, 1, "accepted section lost is_user_defined");
    assert_eq!(
        accepted_name.as_deref(),
        Some("My Named Climb"),
        "accepted section lost its user name"
    );

    let (custom_type, custom_name): (String, Option<String>) = conn
        .query_row(
            "SELECT section_type, name FROM sections WHERE id = 'custom_1700000000000__zzzzy'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("custom section survives the migration");
    assert_eq!(custom_type, "custom");
    assert_eq!(custom_name.as_deref(), Some("My Custom Loop"));
}

/// The 017 rebuild must be safe to run more than once: a crash rolls the
/// migration back and re-runs it from v16. The raw SQL is applied directly
/// because `user_version` would otherwise gate a second application.
#[test]
fn migration_017_is_rerunnable() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v17_rerun.db");

    {
        let conn = seed_v02x_db(&path);
        insert_activity(&conn, "act_r", "Ride", SEED_ACTIVITY_DATE);
        conn.execute(
            "INSERT INTO sections(id, section_type, sport_type, polyline_json,
                distance_meters, version, created_at)
             VALUES ('sec_r', 'auto', 'Ride', '[]', 100.0, 1, datetime('now'))",
            [],
        )
        .expect("section");
        insert_section_portion(&conn, "sec_r", "act_r", 0, 30, 100.0, 300.0, 12.0);
    }
    upgrade_in_place(&path);

    let conn = Connection::open(&path).expect("reopen");
    let sql = b4_core_script();
    conn.execute_batch(sql).expect("second run must not error");
    conn.execute_batch(sql).expect("third run must not error");

    let lap: Option<f64> = conn
        .query_row(
            "SELECT lap_time FROM section_activities WHERE section_id='sec_r' AND activity_id='act_r'",
            [],
            |r| r.get(0),
        )
        .expect("row survives repeated 017 runs");
    assert_eq!(lap, Some(300.0), "repeated 017 must not lose data");

    conn.execute("PRAGMA foreign_keys = ON", [])
        .expect("pragma");
    conn.execute("DELETE FROM activities WHERE id='act_r'", [])
        .expect("delete");
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE activity_id='act_r'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(
        remaining, 0,
        "the cascade must still fire after repeated 017 runs"
    );
}

// ----------------------------------------------------------------------------
// Renumbering guard.
//
// A database reporting `user_version = 13` from a build where B4 core held that
// number is offered 014 onward, so it never sees 013's
// `ALTER TABLE wellness ADD COLUMN raw`. Every other migration in the range is
// CREATE ... IF NOT EXISTS and recovers on its own. That one needs the hook.
// ----------------------------------------------------------------------------

fn seed_db_stranded_at_old_013(path: &Path) {
    let conn = seed_at_version(path, 12);
    drop(conn);

    let conn = Connection::open(path).expect("open seed");
    conn.execute_batch(b4_core_script())
        .expect("B4 core applies under its old number");
    conn.pragma_update(None, "user_version", 13i64)
        .expect("stamp the number the old build wrote");

    assert_eq!(
        user_version(&conn),
        13,
        "the stranded database claims thirteen applied"
    );
    assert!(
        conn.prepare("SELECT raw FROM wellness LIMIT 0").is_err(),
        "the stranded database must genuinely lack the column"
    );
}

#[test]
fn a_database_stranded_at_the_old_013_gains_the_wellness_body_column() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("stranded.db");
    seed_db_stranded_at_old_013(&path);

    upgrade_in_place(&path);

    let conn = Connection::open(&path).expect("reopen");
    assert!(
        conn.prepare("SELECT raw FROM wellness LIMIT 0").is_ok(),
        "the post-migration hook must add the column the renumber skipped"
    );
    conn.execute(
        "INSERT INTO wellness(date, raw) VALUES ('2026-08-08', '{\"vo2max\":52}')",
        [],
    )
    .expect("the column must be writable, not merely present");
}

#[test]
fn a_database_stranded_at_the_old_013_still_reaches_the_current_version() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("stranded_version.db");
    seed_db_stranded_at_old_013(&path);

    upgrade_in_place(&path);

    let conn = Connection::open(&path).expect("reopen");
    assert_eq!(
        user_version(&conn),
        migration_support::latest_version(),
        "the remaining migrations must still apply"
    );

    // B4 core ran under the old number, so its tables must survive the second
    // pass 017 makes over them rather than being rebuilt empty.
    let tables = tables_at(&conn);
    for table in ["identity_state", "section_history", "section_geometry"] {
        assert!(
            tables.contains(&table.to_string()),
            "{table} must survive the renumbered re-apply"
        );
    }
}

/// SB7. A failed FIT download used to be recorded as a settled `has_sets = 0`,
/// which excluded the activity from every retry path for good. The upgrade drops
/// those rows so a poisoned install re-queues its strength activities.
#[test]
fn migration_020_requeues_poisoned_fit_rows() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("fit_poison.db");

    {
        let conn = seed_at_version(&path, 19);
        insert_activity(&conn, "act_lift", "WeightTraining", SEED_ACTIVITY_DATE);
        insert_activity(&conn, "act_kept", "WeightTraining", SEED_ACTIVITY_DATE);
        conn.execute(
            "INSERT INTO fit_file_status(activity_id, processed_at, has_sets)
             VALUES ('act_lift', 1700000000, 0), ('act_kept', 1700000000, 1)",
            [],
        )
        .expect("seed fit status");
    }

    upgrade_in_place(&path);

    let conn = Connection::open(&path).expect("reopen");
    let poisoned: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM fit_file_status WHERE activity_id = 'act_lift'",
            [],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(
        poisoned, 0,
        "a has_sets = 0 row cannot be told apart from a failed download, so the \
         upgrade must re-queue it"
    );

    let kept: String = conn
        .query_row(
            "SELECT outcome FROM fit_file_status WHERE activity_id = 'act_kept'",
            [],
            |r| r.get(0),
        )
        .expect("kept row survives");
    assert_eq!(kept, "parsed", "an activity with sets keeps its verdict");
}
