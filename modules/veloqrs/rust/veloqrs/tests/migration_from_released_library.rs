//! The upgrade each release's installs take on their next update, against the
//! library that release's engine wrote.
//!
//! Every release in `RELEASES` with a library fixture is replayed as its
//! install left it and opened by this build. Every row an athlete would miss
//! has to come through with its values, and the screens have to read it back.
//! A migration that drops or rewrites one of those rows fails here, naming the
//! table, before it reaches a device. The engine quarantines a database it
//! cannot open, so a broken upgrade would otherwise reach the athlete as a
//! working app with an empty library.

use super::migration_support::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

/// The tables holding what the athlete made or synced. Caches the engine
/// rebuilds on open are left out, since rewriting those loses nothing.
const LIBRARY_TABLES: &[&str] = &[
    "activities",
    "activity_metrics",
    "gps_tracks",
    "signatures",
    "sections",
    "section_activities",
    "section_history",
    "section_geometry",
    "section_pins",
    "section_numbers",
    "section_intents",
    "route_groups",
    "route_names",
    "route_numbers",
    "activity_matches",
    "settings",
];

/// Names `examples/released_library.rs` writes into every release's library.
const AUTO_SECTION_NAME: &str = "Vineyard climb";
const CUSTOM_SECTION_NAME: &str = "Lake sprint";
const RETIRED_SECTION_NAME: &str = "Old drag";
const ROUTE_ID: &str = "lib-route-1";
const ROUTE_NAME: &str = "Vineyard loop";
const RIDE_IDS: [&str; 3] = ["lib-ride-1", "lib-ride-2", "lib-ride-3"];
const RUN_ID: &str = "lib-run-1";

fn libraries() -> Vec<(&'static Release, &'static str)> {
    let found: Vec<_> = RELEASES
        .iter()
        .filter_map(|release| release.library.map(|sql| (release, sql)))
        .collect();
    assert!(!found.is_empty(), "no release carries a library fixture");
    found
}

fn replay(sql: &str) -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    Connection::open(&path)
        .expect("open fixture database")
        .execute_batch(sql)
        .expect("replay fixture");
    (dir, path)
}

fn ids(conn: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).expect(sql);
    stmt.query_map([], |row| row.get(0))
        .expect(sql)
        .collect::<Result<_, _>>()
        .expect(sql)
}

fn one_id(conn: &Connection, sql: &str) -> String {
    let found = ids(conn, sql);
    assert_eq!(found.len(), 1, "{sql} found {found:?}");
    found.into_iter().next().unwrap()
}

/// The library's rows table by table, over every column the table has now.
fn snapshot(conn: &Connection) -> Vec<(String, Vec<String>, Vec<Vec<String>>)> {
    LIBRARY_TABLES
        .iter()
        .map(|table| {
            let columns = columns_of(conn, table);
            let rows = rows_of(conn, table, &columns);
            (table.to_string(), columns, rows)
        })
        .collect()
}

fn open_and_load(path: &Path) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.load().expect("load");
    engine
}

#[test]
fn each_release_library_is_that_release_schema_holding_no_real_athlete_data() {
    let _serial_state = super::serial_state();
    for (release, sql) in libraries() {
        let (_dir, path) = replay(sql);
        let conn = Connection::open(&path).expect("reopen");
        assert_eq!(
            user_version(&conn),
            release.user_version,
            "the {} library must replay at its own version; a dump without its trailing \
             PRAGMA replays as v0 and the whole chain runs from scratch",
            release.name
        );

        let seed_dir = TempDir::new().expect("tempdir");
        let seed = seed_at_version(&seed_dir.path().join("seed.db"), release.user_version);
        assert_eq!(
            tables_at(&conn),
            tables_at(&seed),
            "the {} library holds other tables than its migrations make",
            release.name
        );

        for table in LIBRARY_TABLES {
            assert!(
                row_count(&conn, table).is_some_and(|n| n > 0),
                "the {} library has no {table} row to carry",
                release.name
            );
        }
        assert_eq!(
            ids(
                &conn,
                "SELECT id FROM activities WHERE id NOT LIKE 'lib-%' ORDER BY id"
            ),
            Vec::<String>::new(),
            "the {} library holds activity ids it did not invent",
            release.name
        );
        assert_eq!(
            ids(
                &conn,
                "SELECT value FROM settings WHERE key = '__athlete_id' AND value <> 'demo'"
            ),
            Vec::<String>::new(),
            "the {} library holds a real athlete id",
            release.name
        );
    }
}

#[test]
fn upgrading_each_release_library_keeps_every_row_with_its_values() {
    let _serial_state = super::serial_state();
    for (release, sql) in libraries() {
        let (_dir, path) = replay(sql);
        let before = snapshot(&Connection::open(&path).expect("open before"));

        drop(open_and_load(&path));

        let after_conn = Connection::open(&path).expect("open after");
        assert_eq!(user_version(&after_conn), latest_version());
        let mut lost = Vec::new();
        for (table, columns, rows) in before {
            let kept = columns_of(&after_conn, &table);
            if kept.is_empty() {
                lost.push(format!("{table}: the table is gone"));
                continue;
            }
            let shared: Vec<String> = columns
                .iter()
                .filter(|c| kept.contains(c))
                .cloned()
                .collect();
            let dropped: Vec<&String> = columns.iter().filter(|c| !kept.contains(c)).collect();
            if !dropped.is_empty() {
                lost.push(format!("{table}: columns {dropped:?} are gone"));
            }
            let was: Vec<Vec<String>> = {
                let at: Vec<usize> = shared
                    .iter()
                    .map(|c| columns.iter().position(|o| o == c).unwrap())
                    .collect();
                let mut projected: Vec<Vec<String>> = rows
                    .iter()
                    .map(|row| at.iter().map(|&i| row[i].clone()).collect())
                    .collect();
                projected.sort();
                projected
            };
            // A row the open adds, a route number say, loses nothing.
            let mut now = rows_of(&after_conn, &table, &shared);
            let missing: Vec<Vec<String>> = was
                .into_iter()
                .filter(|row| match now.iter().position(|kept| kept == row) {
                    Some(at) => {
                        now.swap_remove(at);
                        false
                    }
                    None => true,
                })
                .collect();
            if !missing.is_empty() {
                lost.push(format!(
                    "{table}: {} rows no longer read as they did: {missing:?}",
                    missing.len()
                ));
            }
        }
        assert!(
            lost.is_empty(),
            "upgrading the {} library lost what the athlete had:\n{}",
            release.name,
            lost.join("\n")
        );
    }
}

#[test]
fn an_upgraded_release_library_reads_back_through_the_screens() {
    let _serial_state = super::serial_state();
    for (release, sql) in libraries() {
        let (_dir, path) = replay(sql);
        let (auto, custom, retired) = {
            let conn = Connection::open(&path).expect("open fixture");
            (
                one_id(&conn, "SELECT id FROM sections WHERE section_type = 'auto'"),
                one_id(
                    &conn,
                    "SELECT id FROM sections WHERE section_type = 'custom'",
                ),
                one_id(
                    &conn,
                    "SELECT DISTINCT section_id FROM section_history
                     WHERE section_id NOT IN (SELECT id FROM sections)",
                ),
            )
        };
        let engine = open_and_load(&path);
        let name = release.name;

        let detail = engine.section_detail_data(&auto);
        let section = detail
            .section
            .as_ref()
            .unwrap_or_else(|| panic!("{name}: the auto section is gone"));
        assert_eq!(section.name.as_deref(), Some(AUTO_SECTION_NAME), "{name}");
        let mut riders: Vec<&str> = detail
            .activity_rows
            .iter()
            .map(|r| r.activity_id.as_str())
            .collect();
        riders.sort();
        assert_eq!(riders, RIDE_IDS, "{name}: the auto section's rides");
        assert_eq!(detail.pinned_version, Some(1.0), "{name}: the pin");
        assert!(
            detail.geometry_versions.iter().any(|v| v.pinned),
            "{name}: the pinned version is not listed"
        );

        let detail = engine.section_detail_data(&custom);
        let section = detail
            .section
            .as_ref()
            .unwrap_or_else(|| panic!("{name}: the custom section is gone"));
        assert_eq!(section.name.as_deref(), Some(CUSTOM_SECTION_NAME), "{name}");
        assert_eq!(
            detail
                .activity_rows
                .iter()
                .map(|r| r.activity_id.as_str())
                .collect::<Vec<_>>(),
            [RUN_ID],
            "{name}: the custom section's run"
        );

        let detail = engine.section_detail_data(&retired);
        assert!(
            detail.section.is_none(),
            "{name}: the retired section is live"
        );
        let retirement = detail
            .retirement
            .unwrap_or_else(|| panic!("{name}: the retirement is gone"));
        assert_eq!(retirement.kind, "superseded", "{name}");
        assert_eq!(retirement.into.as_deref(), Some(auto.as_str()), "{name}");
        assert_eq!(
            retirement.into_name.as_deref(),
            Some(AUTO_SECTION_NAME),
            "{name}"
        );
        assert!(
            !detail.history.is_empty(),
            "{name}: the retired section's history is gone"
        );
        assert!(
            !detail.geometry_versions.is_empty(),
            "{name}: the retired section's line is gone"
        );

        let retired_map = engine.retired_map_data();
        let listed = format!("{retired_map:?}");
        assert!(
            listed.contains(&retired) && listed.contains(RETIRED_SECTION_NAME),
            "{name}: the retired map does not list {retired}"
        );

        let route = engine.route_detail_data(ROUTE_ID);
        let group = route
            .group
            .as_ref()
            .unwrap_or_else(|| panic!("{name}: the route group is gone"));
        assert_eq!(group.custom_name.as_deref(), Some(ROUTE_NAME), "{name}");
        let mut members: Vec<&str> = group.activity_ids.iter().map(String::as_str).collect();
        members.sort();
        assert_eq!(members, RIDE_IDS, "{name}: the route's rides");
        assert!(
            !route.encoded_representative.is_empty(),
            "{name}: the route has no line"
        );

        let activity = engine.activity_detail_data(RUN_ID, 1);
        let listed = format!("{activity:?}");
        assert!(
            listed.contains(&custom),
            "{name}: the run's detail does not name its custom section"
        );

        assert_eq!(
            engine.get_setting("unit_system").expect("read setting"),
            Some("metric".to_string()),
            "{name}: settings"
        );
    }
}

/// The ground pairs the retired map reads, as the upgraded file stores them.
fn stored_ground_pairs(path: &Path) -> Vec<(String, String)> {
    let conn = Connection::open(path).expect("open after");
    let mut stmt = conn
        .prepare("SELECT retired_id, current_id FROM retired_ground_pairs ORDER BY 1, 2")
        .expect("the stored pairs");
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("the stored pairs")
        .collect::<Result<_, _>>()
        .expect("the stored pairs")
}

#[test]
fn an_upgraded_release_library_owes_its_ground_pairs_until_the_worker_measures_them() {
    let _serial_state = super::serial_state();
    for (release, sql) in libraries() {
        let (_dir, path) = replay(sql);
        let (auto, retired) = {
            let conn = Connection::open(&path).expect("open fixture");
            (
                one_id(&conn, "SELECT id FROM sections WHERE section_type = 'auto'"),
                one_id(
                    &conn,
                    "SELECT DISTINCT section_id FROM section_history
                     WHERE section_id NOT IN (SELECT id FROM sections)",
                ),
            )
        };
        let engine = open_and_load(&path);
        let name = release.name;

        let owed = engine.retired_map_data();
        assert!(owed.pairs_pending, "{name}: an upgraded table is level");
        assert!(
            stored_ground_pairs(&path).is_empty(),
            "{name}: the upgrade measured ground"
        );

        assert!(engine.level_retired_pairs().expect("level") > 0, "{name}");
        let level = engine.retired_map_data();
        assert!(!level.pairs_pending, "{name}: still owed once measured");
        assert_eq!(
            stored_ground_pairs(&path),
            vec![(retired.clone(), auto.clone())],
            "{name}: the retired line shares the auto section's ground"
        );
        let shown: Vec<(String, String, veloqrs::FfiRetiredPairLink)> = level
            .pairs
            .iter()
            .map(|p| (p.retired_id.clone(), p.current_id.clone(), p.link))
            .collect();
        assert_eq!(
            shown,
            vec![(retired, auto, veloqrs::FfiRetiredPairLink::Ledger)],
            "{name}: the ledger link names the pair the ground also finds"
        );
    }
}
