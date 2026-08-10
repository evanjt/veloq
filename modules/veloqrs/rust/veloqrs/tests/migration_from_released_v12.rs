//! The upgrade every live user actually takes, against a database a released
//! binary actually wrote.
//!
//! `migration_v02x_to_current` covers the same version range from seeds this
//! crate builds out of its own migration files. That proves the chain is
//! self-consistent, not that it survives contact with a real 0.3.8 install.
//! `tests/fixtures/v12_demo.sql` is a `sqlite3 .dump` of `routes.db` pulled off
//! an emulator running `veloq-0.3.8.apk` in demo mode, so the blobs, the index
//! set and the row shapes here are the shipped ones.
//!
//! The failure this guards is quiet. `persistent_engine_init` quarantines a
//! database it cannot open and recreates it, so a broken migration reaches the
//! user as a working app with an empty library. Every assertion below is about
//! data surviving with its original values.

mod migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

const FIXTURE: &str = include_str!("fixtures/v12_demo.sql");

/// What 0.3.8 left behind. Literals rather than queries against the fixture: if
/// a recapture changes the shape, these fail and someone reads the diff instead
/// of the suite quietly re-baselining onto whatever the new file happens to hold.
const FIXTURE_ACTIVITIES: i64 = 75;
const FIXTURE_SECTIONS: i64 = 42;
const FIXTURE_JUNCTION_ROWS: i64 = 279;
const FIXTURE_ROUTE_GROUPS: i64 = 45;

/// Activities removed before the upgrade to strand junction rows. Migration 017
/// filters those rows out on the way through, and that delete is one-way.
/// The busiest members are chosen, so more than one row strands per activity,
/// and ties break on id so the count 017 removes is stable across runs.
const ORPHANED_ACTIVITY_COUNT: usize = 3;

fn replay_fixture(path: &Path) -> Connection {
    let conn = Connection::open(path).expect("open fixture database");
    conn.execute_batch(FIXTURE).expect("replay fixture");
    conn
}

fn seeded_fixture() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    drop(replay_fixture(&path));
    (dir, path)
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).expect(sql)
}

/// Junction rows as an ordered set, so a comparison can name which rows moved
/// rather than only noticing that the total changed.
fn junction_rows(conn: &Connection) -> Vec<(String, String, i64)> {
    let mut stmt = conn
        .prepare(
            "SELECT section_id, activity_id, start_index FROM section_activities ORDER BY 1, 2, 3",
        )
        .expect("prepare junction read");
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("read junction")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect junction");
    rows
}

fn migrate_only(path: &Path) {
    drop(PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine"));
}

#[test]
fn the_fixture_is_a_released_v12_database_holding_no_real_athlete_data() {
    let (_dir, path) = seeded_fixture();
    let conn = Connection::open(&path).expect("reopen");

    assert_eq!(
        user_version(&conn),
        12,
        "fixture must replay at v12. sqlite3 .dump omits user_version, so a fixture \
         missing its trailing PRAGMA replays as v0 and the whole chain runs from scratch"
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM activities"),
        FIXTURE_ACTIVITIES
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM sections"),
        FIXTURE_SECTIONS
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM section_activities"),
        FIXTURE_JUNCTION_ROWS
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM route_groups"),
        FIXTURE_ROUTE_GROUPS
    );

    // The fixture is committed to a public repository. A recapture that picks up
    // a real account has to fail here rather than in review, which is the control
    // that was missing when the private routes.db was committed.
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM activities WHERE id NOT LIKE 'demo-%'"
        ),
        0,
        "fixture holds non-demo activity ids"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM settings WHERE key = '__athlete_id' AND value <> 'demo'"
        ),
        0,
        "fixture holds a real athlete id"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM settings
             WHERE lower(key) LIKE '%key%' OR lower(key) LIKE '%token%'
                OR lower(value) LIKE '%bearer %'"
        ),
        0,
        "fixture holds credential-shaped settings"
    );
}

#[test]
fn upgrading_a_released_v12_database_preserves_every_activity_and_section() {
    let (_dir, path) = seeded_fixture();

    let before = Connection::open(&path).expect("open before");
    let activities_before: BTreeMap<String, (Option<String>, Option<f64>)> = {
        let mut stmt = before
            .prepare("SELECT id, sport_type, distance_meters FROM activities")
            .expect("prepare");
        stmt.query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?))))
            .expect("read")
            .collect::<Result<_, _>>()
            .expect("collect")
    };
    let sections_before = count(&before, "SELECT COUNT(*) FROM sections");
    let names_before = count(&before, "SELECT COUNT(*) FROM route_names");
    drop(before);

    migrate_only(&path);

    let after = Connection::open(&path).expect("open after");
    assert_eq!(
        user_version(&after),
        latest_version(),
        "engine must land on the current schema version"
    );

    let activities_after: BTreeMap<String, (Option<String>, Option<f64>)> = {
        let mut stmt = after
            .prepare("SELECT id, sport_type, distance_meters FROM activities")
            .expect("prepare");
        stmt.query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?))))
            .expect("read")
            .collect::<Result<_, _>>()
            .expect("collect")
    };

    assert_eq!(
        activities_after, activities_before,
        "every activity must survive the upgrade with its original sport and distance"
    );
    assert_eq!(
        count(&after, "SELECT COUNT(*) FROM sections"),
        sections_before
    );
    assert_eq!(
        count(&after, "SELECT COUNT(*) FROM route_names"),
        names_before
    );

    // GPS payloads are the expensive, unrecoverable part of the cache. A
    // migration that rewrote a blob column would still leave the row count right.
    let tracks: i64 = count(
        &after,
        "SELECT COUNT(*) FROM gps_tracks WHERE track_data IS NOT NULL AND length(track_data) > 0",
    );
    assert_eq!(
        tracks, FIXTURE_ACTIVITIES,
        "every GPS track must still carry its payload"
    );
}

#[test]
fn migration_017_deletes_exactly_the_stranded_junction_rows() {
    let (_dir, path) = seeded_fixture();

    let before = Connection::open(&path).expect("open before");
    assert_eq!(
        count(
            &before,
            "SELECT COUNT(*) FROM section_activities sa
             LEFT JOIN activities a ON a.id = sa.activity_id WHERE a.id IS NULL"
        ),
        0,
        "the captured database is internally consistent, so the test creates the \
         orphans itself rather than depending on the capture having any"
    );

    // Strand junction rows the way remove_activity did before 017 added the
    // second foreign key: delete the activity, leave the membership behind.
    let doomed: Vec<String> = {
        let mut stmt = before
            .prepare(
                "SELECT activity_id FROM section_activities
                 GROUP BY activity_id ORDER BY COUNT(*) DESC, activity_id LIMIT ?1",
            )
            .expect("prepare");
        stmt.query_map([ORPHANED_ACTIVITY_COUNT as i64], |row| row.get(0))
            .expect("read")
            .collect::<Result<_, _>>()
            .expect("collect")
    };
    assert_eq!(
        doomed.len(),
        ORPHANED_ACTIVITY_COUNT,
        "fixture must hold enough activities with section memberships"
    );

    let placeholders = doomed.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let params: Vec<&dyn rusqlite::ToSql> =
        doomed.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    before
        .execute(
            &format!("DELETE FROM activities WHERE id IN ({placeholders})"),
            params.as_slice(),
        )
        .expect("strand memberships");

    let expected_orphans = count(
        &before,
        "SELECT COUNT(*) FROM section_activities sa
         LEFT JOIN activities a ON a.id = sa.activity_id WHERE a.id IS NULL",
    );
    assert!(
        expected_orphans > 0,
        "deleting {ORPHANED_ACTIVITY_COUNT} activities must strand at least one junction row, \
         otherwise this test cannot observe 017's filter at all"
    );

    let rows_before = junction_rows(&before);
    let survivors_expected: Vec<_> = {
        let live: Vec<String> = {
            let mut stmt = before
                .prepare("SELECT id FROM activities")
                .expect("prepare");
            stmt.query_map([], |row| row.get(0))
                .expect("read")
                .collect::<Result<_, _>>()
                .expect("collect")
        };
        rows_before
            .iter()
            .filter(|(_, activity, _)| live.contains(activity))
            .cloned()
            .collect()
    };
    drop(before);

    migrate_only(&path);

    let after = Connection::open(&path).expect("open after");
    let rows_after = junction_rows(&after);

    assert_eq!(
        rows_after.len() as i64,
        rows_before.len() as i64 - expected_orphans,
        "017 removed {} junction rows, expected exactly {expected_orphans}",
        rows_before.len() as i64 - rows_after.len() as i64
    );
    assert_eq!(
        rows_after, survivors_expected,
        "017 must drop the stranded rows and nothing else. This delete is one-way: \
         a filter that is too wide silently destroys section history for activities \
         the user still has"
    );
    assert_eq!(
        count(
            &after,
            "SELECT COUNT(*) FROM section_activities sa
             LEFT JOIN activities a ON a.id = sa.activity_id WHERE a.id IS NULL"
        ),
        0,
        "no stranded row may survive the rebuild"
    );
}

#[test]
fn visit_count_is_recomputed_after_the_orphan_filter_not_before() {
    let (_dir, path) = seeded_fixture();

    let before = Connection::open(&path).expect("open before");
    let doomed: Vec<String> = {
        let mut stmt = before
            .prepare(
                "SELECT activity_id FROM section_activities
                 GROUP BY activity_id ORDER BY COUNT(*) DESC, activity_id LIMIT ?1",
            )
            .expect("prepare");
        stmt.query_map([ORPHANED_ACTIVITY_COUNT as i64], |row| row.get(0))
            .expect("read")
            .collect::<Result<_, _>>()
            .expect("collect")
    };
    let placeholders = doomed.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let params: Vec<&dyn rusqlite::ToSql> =
        doomed.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    before
        .execute(
            &format!("DELETE FROM activities WHERE id IN ({placeholders})"),
            params.as_slice(),
        )
        .expect("strand memberships");

    // What visit_count would say if the hook counted the pre-rebuild junction.
    // The inflated reading is the bug 017 exists to remove, so the two numbers
    // must differ or this test proves nothing.
    let inflated: i64 = count(
        &before,
        "SELECT COUNT(*) FROM section_activities WHERE excluded = 0",
    );
    drop(before);

    migrate_only(&path);

    let after = Connection::open(&path).expect("open after");
    let honest: i64 = count(
        &after,
        "SELECT COUNT(*) FROM section_activities WHERE excluded = 0",
    );
    assert!(
        honest < inflated,
        "stranding rows must reduce the live membership, otherwise the orphan filter \
         and the visit_count recompute cannot be told apart"
    );

    let mismatched: i64 = count(
        &after,
        "SELECT COUNT(*) FROM sections s WHERE s.visit_count <> (
             SELECT COUNT(*) FROM section_activities sa
             WHERE sa.section_id = s.id AND sa.excluded = 0
         )",
    );
    assert_eq!(
        mismatched, 0,
        "every section's visit_count must equal its live, non-excluded membership. \
         A count taken before 017's rebuild leaves sections claiming traversals by \
         activities the user deleted"
    );

    let total: i64 = count(&after, "SELECT COALESCE(SUM(visit_count), 0) FROM sections");
    assert_eq!(
        total, honest,
        "the denormalised counts must sum to the junction they denormalise"
    );
}

#[test]
fn a_released_v12_database_upgrades_to_the_same_schema_as_a_fresh_install() {
    let (_dir, path) = seeded_fixture();
    migrate_only(&path);
    let upgraded = Connection::open(&path).expect("open upgraded");

    let fresh_dir = TempDir::new().expect("tempdir");
    let fresh_path = fresh_dir.path().join("routes.db");
    migrate_only(&fresh_path);
    let fresh = Connection::open(&fresh_path).expect("open fresh");

    assert_eq!(user_version(&upgraded), user_version(&fresh));
    assert_eq!(
        tables_at(&upgraded),
        tables_at(&fresh),
        "an upgraded install must end with the same table set as a fresh one"
    );

    for table in tables_at(&fresh) {
        assert_eq!(
            columns_of(&upgraded, &table),
            columns_of(&fresh, &table),
            "column set diverged on {table}"
        );
    }
}
