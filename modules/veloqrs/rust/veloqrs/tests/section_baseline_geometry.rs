//! Baseline geometry for sections that pre-date the ledger.
//!
//! A live install arrives at the history tables with a full catalogue and an
//! empty ledger, so the first change to any section has no prior to sit beside.
//! The upgrade seeds one: the section's current line as version 1, backdated to
//! its earliest member ride, recorded as a consensus line with no
//! representative triple because the detector that cut it never stored one.

mod migration_support;

use migration_support::seed_at_version;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

/// Epoch seconds, well before any plausible upgrade day.
const RIDE_ONE: i64 = 1_600_000_000;
const RIDE_TWO: i64 = 1_610_000_000;

fn synthetic_polyline_json(offset: f64) -> String {
    let points: Vec<serde_json::Value> = (0..12)
        .map(|i| {
            serde_json::json!({
                "latitude": 40.0 + offset + f64::from(i) * 0.000_1,
                "longitude": 5.0 + f64::from(i) * 0.000_1,
                "elevation": serde_json::Value::Null,
            })
        })
        .collect();
    serde_json::to_string(&points).expect("encode polyline")
}

fn seed_populated_v12(path: &Path) {
    let conn = seed_at_version(path, 12);
    conn.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
         VALUES ('a1', 'Ride', 40.0, 40.1, 5.0, 5.1, ?)",
        [RIDE_ONE],
    )
    .expect("insert first activity");
    conn.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng, start_date)
         VALUES ('a2', 'Ride', 40.0, 40.1, 5.0, 5.1, ?)",
        [RIDE_TWO],
    )
    .expect("insert second activity");

    for (id, offset) in [("s_old_one", 0.0), ("s_old_two", 0.01)] {
        conn.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES (?, 'auto', 'Ride', ?, 1200.0)",
            rusqlite::params![id, synthetic_polyline_json(offset)],
        )
        .expect("insert section");
    }
    conn.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
         VALUES ('s_old_one', 'a2', 0, 10), ('s_old_one', 'a1', 0, 10),
                ('s_old_two', 'a2', 0, 10)",
        [],
    )
    .expect("insert junction rows");
}

fn upgrade(path: &Path) {
    drop(PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine"));
}

fn baseline_rows(conn: &Connection) -> Vec<(String, i64, String, i64, Option<String>)> {
    let mut stmt = conn
        .prepare(
            "SELECT section_id, version, created_at, milestone, source
             FROM section_geometry ORDER BY section_id",
        )
        .expect("prepare geometry read");
    stmt.query_map([], |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
        ))
    })
    .expect("query geometry")
    .collect::<Result<Vec<_>, _>>()
    .expect("collect geometry")
}

#[test]
fn upgrade_seeds_one_backdated_consensus_version_per_section() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    seed_populated_v12(&path);
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    let rows = baseline_rows(&conn);
    assert_eq!(
        rows.len(),
        2,
        "both pre-ledger sections need a birth geometry"
    );

    // s_old_one rides both activities, s_old_two only the later one.
    for (section_id, version, created_at, milestone, source) in &rows {
        assert_eq!(*version, 1, "{section_id} baseline must be version 1");
        assert_eq!(*milestone, 1, "{section_id} baseline must be a milestone");
        assert_eq!(source.as_deref(), Some("consensus"));
        let expected = match section_id.as_str() {
            "s_old_one" => "2020-09-13",
            _ => "2021-01-07",
        };
        assert!(
            created_at.starts_with(expected),
            "{section_id} geometry is stamped {created_at}, not its earliest member ride"
        );
    }

    let triples: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_geometry
             WHERE rep_activity_id IS NOT NULL OR rep_start_index IS NOT NULL
                OR rep_end_index IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .expect("count triples");
    assert_eq!(
        triples, 0,
        "a corridor-era line belongs to no single activity, so it must claim no triple"
    );
}

/// Expected behaviour: the event is dated to the section's first ride, carries
/// the geometry it describes, and says which upgrade wrote it.
#[test]
fn the_baseline_event_is_backdated_and_linked_to_version_one() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    seed_populated_v12(&path);
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    let (at, kind, details, version): (String, String, String, i64) = conn
        .query_row(
            "SELECT at, kind, details, geometry_version FROM section_history
             WHERE section_id = 's_old_one'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("read baseline event");

    assert_eq!(kind, "baseline");
    assert_eq!(version, 1);
    assert!(
        at.starts_with("2020-09-13"),
        "event is stamped {at}, which claims the section was born on upgrade day"
    );

    let parsed: serde_json::Value = serde_json::from_str(&details).expect("details is JSON");
    assert_eq!(parsed["source"], "upgrade");
    assert_eq!(parsed["schema_from"], 12);
    assert_eq!(parsed["activity_count"], 2);
    assert_eq!(
        parsed["detector"], "corridor",
        "every catalogue that pre-dates the marker was cut by corridor"
    );
}

fn schema_info(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM schema_info WHERE key = ?",
        [key],
        |row| row.get(0),
    )
    .ok()
}

/// Scenario: the upgrade a live user takes, whose catalogue no build ever
/// stamped a generation on.
/// Expected behaviour: the seed names the detector that cut it, so the first
/// detect under a different one has something to have changed from.
#[test]
fn seeding_stamps_the_pre_ledger_generation() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    seed_populated_v12(&path);
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    assert_eq!(
        schema_info(&conn, "catalogue_detection_method").as_deref(),
        Some("corridor")
    );
    assert_eq!(
        schema_info(&conn, "catalogue_config_digest").as_deref(),
        Some("pre-ledger"),
        "the digest is a sentinel, and must not read as a real config"
    );
}

/// Expected behaviour: a marker a save already wrote is authoritative, so the
/// seed never rewrites a live generation as corridor.
#[test]
fn seeding_leaves_an_existing_generation_alone() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    seed_populated_v12(&path);
    {
        let conn = Connection::open(&path).expect("open seeded database");
        for (key, value) in [
            ("catalogue_detection_method", "unified"),
            ("catalogue_config_digest", "0123456789abcdef"),
        ] {
            conn.execute(
                "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
                rusqlite::params![key, value],
            )
            .expect("stamp marker");
        }
    }
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    assert_eq!(
        schema_info(&conn, "catalogue_detection_method").as_deref(),
        Some("unified")
    );
    assert_eq!(
        schema_info(&conn, "catalogue_config_digest").as_deref(),
        Some("0123456789abcdef")
    );
}

#[test]
fn a_second_open_seeds_nothing_further() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    seed_populated_v12(&path);
    upgrade(&path);
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    assert_eq!(baseline_rows(&conn).len(), 2);
    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM section_history", [], |row| row.get(0))
        .expect("count events");
    assert_eq!(
        events, 2,
        "the seeding hook ran twice and doubled the ledger"
    );
}

/// Expected behaviour: a fresh install has nothing to carry forward, and the
/// sections it detects later get real `formed` events instead of a fabricated
/// birth.
#[test]
fn a_fresh_install_seeds_no_baseline() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("fresh.db");
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    assert!(baseline_rows(&conn).is_empty());
    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM section_history", [], |row| row.get(0))
        .expect("count events");
    assert_eq!(events, 0);
    assert!(
        schema_info(&conn, "section_geometry_baseline_v1").is_some(),
        "the empty catalogue is a completed seed, not a pending one"
    );
    assert!(
        schema_info(&conn, "catalogue_detection_method").is_none(),
        "nothing cut this catalogue, so no generation may be claimed for it"
    );
}

/// Scenario: a database whose `section_geometry` was created before the
/// provenance columns, which only the ALTER path in
/// `ensure_section_geometry_provenance` can repair.
/// Expected behaviour: the column arrives and accepts the values the CHECK
/// allows.
#[test]
fn a_geometry_table_without_source_is_altered_on_open() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 16);
        conn.execute(
            "CREATE TABLE section_geometry (
                 section_id TEXT NOT NULL,
                 version INTEGER NOT NULL,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 encoding INTEGER NOT NULL DEFAULT 1,
                 blob BLOB NOT NULL,
                 milestone INTEGER NOT NULL DEFAULT 0,
                 rep_activity_id TEXT,
                 rep_start_index INTEGER,
                 rep_end_index INTEGER,
                 PRIMARY KEY (section_id, version))",
            [],
        )
        .expect("create pre-provenance geometry table");
        conn.execute(
            "INSERT INTO section_geometry (section_id, version, blob)
             VALUES ('s_old', 1, x'00')",
            [],
        )
        .expect("insert pre-provenance row");
        assert!(
            conn.prepare("SELECT source FROM section_geometry LIMIT 0")
                .is_err(),
            "the seed must genuinely lack the column, or this test proves nothing"
        );
    }
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    let existing: Option<String> = conn
        .query_row(
            "SELECT source FROM section_geometry WHERE section_id = 's_old'",
            [],
            |row| row.get(0),
        )
        .expect("read the added column");
    assert!(existing.is_none(), "an existing row is unstated provenance");

    conn.execute(
        "INSERT INTO section_geometry (section_id, version, blob, source)
         VALUES ('s_new', 1, x'00', 'consensus')",
        [],
    )
    .expect("the added column must be writable");
    conn.execute(
        "INSERT INTO section_geometry (section_id, version, blob, source)
         VALUES ('s_bad', 1, x'00', 'nonsense')",
        [],
    )
    .expect_err("the CHECK must survive the ALTER");
}

/// Scenario: a section whose junction rows are gone, so nothing dates it.
/// Expected behaviour: it still gets a birth geometry, stamped now rather than
/// dropped.
#[test]
fn a_section_with_no_member_rides_falls_back_to_now() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    {
        let conn = seed_at_version(&path, 12);
        conn.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('s_lonely', 'auto', 'Ride', ?, 900.0)",
            rusqlite::params![synthetic_polyline_json(0.02)],
        )
        .expect("insert section");
    }
    upgrade(&path);

    let conn = Connection::open(&path).expect("reopen");
    let rows = baseline_rows(&conn);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].1, 1);
}
