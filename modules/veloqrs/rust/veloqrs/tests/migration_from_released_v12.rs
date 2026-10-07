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

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

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

    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("read junction")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect junction")
}

fn migrate_only(path: &Path) {
    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open engine"));
}

#[test]
fn the_fixture_is_a_released_v12_database_holding_no_real_athlete_data() {
    let _serial_state = super::serial_state();
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
    let _serial_state = super::serial_state();
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
fn upgrading_a_released_v12_database_adds_empty_lap_power_without_losing_laps() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    let before = Connection::open(&path).unwrap();
    let lap_count = count(&before, "SELECT COUNT(*) FROM section_activities");
    drop(before);

    migrate_only(&path);

    let after = Connection::open(&path).unwrap();
    assert_eq!(
        count(&after, "SELECT COUNT(*) FROM section_activities"),
        lap_count
    );
    assert_eq!(
        count(
            &after,
            "SELECT COUNT(*) FROM pragma_table_info('section_activities') WHERE name = 'avg_power'",
        ),
        1,
        "section_activities must hold lap power"
    );
    assert_eq!(
        count(
            &after,
            "SELECT COUNT(*) FROM section_activities WHERE avg_power IS NOT NULL",
        ),
        0
    );
}

#[test]
fn migration_017_deletes_exactly_the_stranded_junction_rows() {
    let _serial_state = super::serial_state();
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
    let _serial_state = super::serial_state();
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
    let _serial_state = super::serial_state();
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

/// The internal key is ours and the intervals.icu id is metadata beside it.
/// Every key a released build wrote IS the server's id, so the backfill has to
/// leave every upgraded row able to name itself upstream. A NULL here is an
/// activity the app can no longer fetch a stream, a body or a FIT file for.
#[test]
fn every_upgraded_activity_carries_the_server_id_it_was_keyed_by() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    drop(PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("upgrade"));

    let conn = Connection::open(&path).expect("reopen");
    assert_eq!(
        count(&conn, "SELECT count(*) FROM activities"),
        FIXTURE_ACTIVITIES,
        "the upgrade kept the rows it always kept"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM activities WHERE intervals_id IS NULL"
        ),
        0,
        "a row with no server id cannot be fetched for again"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM activities WHERE intervals_id <> id"
        ),
        0,
        "the key a released build wrote is the server's id, verbatim"
    );
}

/// Scenario: an athlete on a released build upgrades, records a ride, types
/// notes and sets the effort, and the ride waits in the queue across a
/// relaunch. The upgrade from 12 is the one every live install takes.
///
/// Expected behaviour: the upgraded recordings table holds both and the
/// owed flag, and an upgraded body can hold the id a trackless upload gains.
#[test]
fn an_upgraded_database_keeps_a_rides_notes_and_effort_across_a_relaunch() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    {
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("upgrade");
        engine
            .insert_recording(&veloqrs::persistence::FfiRecordingEntry {
                id: "r1".to_string(),
                kind: "fit".to_string(),
                fit_path: "/recordings/r1.fit".to_string(),
                streams_path: None,
                activity_type: "Ride".to_string(),
                name: "Evening ride".to_string(),
                start_time: 1_757_200_000_000.0,
                duration_seconds: 3_600.0,
                distance_meters: 28_400.0,
                elevation_gain: None,
                avg_heartrate: None,
                paired_event_id: None,
                created_at: 1_757_203_600_000.0,
                upload_status: "pending".to_string(),
                retry_count: 0,
                last_attempt_at: None,
                last_error: None,
                intervals_activity_id: None,
                engine_activity_id: None,
                engine_reconciled: false,
                athlete_id: Some("i296629".to_string()),
                notes: Some("legs heavy".to_string()),
                rpe: Some(8),
                rpe_sent: false,
            })
            .expect("insert");
    }

    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("relaunch");
    let row = engine
        .get_recording("r1")
        .unwrap()
        .expect("the ride survived");
    assert_eq!(row.notes.as_deref(), Some("legs heavy"));
    assert_eq!(row.rpe, Some(8));
    assert!(!row.rpe_sent);
    drop(engine);

    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM pragma_table_info('activity_bodies') WHERE name = 'intervals_id'"
        ),
        1,
        "an upgraded body can hold the id a trackless upload gains"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM activity_bodies WHERE intervals_id IS NOT NULL"
        ),
        0,
        "no upgraded body claims an id it was never given"
    );
}

/// Scenario: a released install upgrades, and its first launch runs the
/// cutover over the catalogue 0.3.8 cut.
///
/// Expected behaviour: every section the cut replaces is kept as an
/// `archived` ledger state whose version draws its line, so the pre-cutover
/// catalogue can still be pinned and rolled back to, and travels in the record.
#[test]
fn the_cutover_keeps_an_upgraded_catalogue_in_the_ledger() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    assert!(
        veloqrs::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
            path.to_str().unwrap().to_string()
        )
    );
    let outgoing = count(
        &Connection::open(&path).unwrap(),
        "SELECT COUNT(*) FROM sections
         WHERE section_type = 'auto' AND original_polyline_json IS NULL
           AND is_user_defined = 0 AND disabled = 0",
    );
    assert!(outgoing > 0, "the fixture has no catalogue to cut over");

    let outcome = veloqrs::persistence::cutover::run_cutover().expect("cutover");
    assert!(matches!(
        outcome,
        veloqrs::persistence::cutover::CutoverOutcome::Completed(_)
    ));

    let conn = Connection::open(&path).unwrap();
    let archived: Vec<(String, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT section_id, geometry_version FROM section_history
                 WHERE kind = 'archived' ORDER BY section_id",
            )
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert_eq!(archived.len() as i64, outgoing);
    for (id, version) in archived {
        let drawn = veloqrs::persistence::with_persistent_engine(|e| {
            e.section_geometry_version(&id, version)
        })
        .unwrap();
        assert!(
            drawn.is_some_and(|(points, _)| points.len() >= 2),
            "{id} has no line at version {version}"
        );
    }
}

/// Scenario: an upgraded library with nothing left to elevate is opened and
/// nothing outside the engine asks for the cutover.
/// Expected behaviour: the open starts it and the cutover completes.
#[test]
fn opening_an_upgraded_library_starts_the_cutover_itself() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    assert!(
        veloqrs::persistence::persistent_engine_ffi::persistent_engine_init(
            path.to_str().unwrap().to_string()
        )
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while veloqrs::persistence::cutover::cutover_pending()
        || veloqrs::persistence::cutover::cutover_running()
    {
        assert!(
            std::time::Instant::now() < deadline,
            "the cutover was never started"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// `(source, blob bytes)` of one stored geometry version.
fn geometry_version_row(conn: &Connection, section_id: &str, version: i64) -> (String, usize) {
    conn.query_row(
        "SELECT source, length(blob) FROM section_geometry WHERE section_id = ? AND version = ?",
        rusqlite::params![section_id, version],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .expect("the archived version")
}

/// Every `archived` ledger row, as `(section_id, version)` in id order.
fn archived_states(conn: &Connection) -> Vec<(String, i64)> {
    let mut stmt = conn
        .prepare(
            "SELECT section_id, geometry_version FROM section_history
             WHERE kind = 'archived' ORDER BY section_id",
        )
        .expect("prepare");
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("read")
        .collect::<Result<_, _>>()
        .expect("collect")
}

fn drawn_state(section_id: &str, version: i64) -> Vec<tracematch::GpsPoint> {
    veloqrs::persistence::with_persistent_engine(|e| {
        e.section_geometry_version(section_id, version)
    })
    .expect("engine")
    .map(|(points, _)| points)
    .unwrap_or_default()
}

fn canonical_line(line: &[tracematch::GpsPoint]) -> Vec<tracematch::GpsPoint> {
    veloqrs::persistence::codec::decode_polyline(&veloqrs::persistence::codec::encode_polyline(
        line,
    ))
    .expect("decode")
}

/// One outgoing section given a reference range into its representative
/// ride, with its stored line set to `line`.
fn give_reference(
    conn: &Connection,
    section_id: &str,
    range: (&str, u32, u32),
    line: &[tracematch::GpsPoint],
) {
    conn.execute(
        "UPDATE sections
            SET representative_activity_id = ?2, rep_start_index = ?3, rep_end_index = ?4,
                polyline_blob = ?5, geometry_source = 'exact'
          WHERE id = ?1",
        rusqlite::params![
            section_id,
            range.0,
            range.1,
            range.2,
            veloqrs::persistence::codec::serialize_track_points(line)
        ],
    )
    .expect("give the section its range");
}

/// Scenario: a released install upgrades with three outgoing sections that
/// carry a range: one the stored ride re-slices, one whose ride is absent and
/// one whose range runs past the end of its ride. The first cutover dies on
/// the diff write, the next launch completes it, and the absent ride then
/// syncs.
///
/// Expected behaviour: each section's archived state draws its line through
/// the failed run, the promotion and the recovery. The run that failed leaves
/// the token in flight and the second run reuses its states rather than
/// archiving again. The arriving ride settles its state onto the range, and a
/// run after that is not owed and leaves every state where it was.
#[test]
fn an_upgraded_section_whose_ride_or_range_does_not_resolve_keeps_its_line_across_a_retry() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    migrate_only(&path);

    let conn = Connection::open(&path).unwrap();
    let candidates: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.representative_activity_id, a.sport_type
                 FROM sections s
                 JOIN gps_tracks t ON t.activity_id = s.representative_activity_id
                 JOIN activities a ON a.id = s.representative_activity_id
                 WHERE s.section_type = 'auto' AND s.original_polyline_json IS NULL
                   AND s.is_user_defined = 0 AND s.disabled = 0 AND t.point_count >= 40
                 ORDER BY s.id",
            )
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    let mut chosen: Vec<(String, String, String)> = Vec::new();
    for candidate in candidates {
        if chosen.iter().all(|(_, ride, _)| *ride != candidate.1) {
            chosen.push(candidate);
        }
    }
    assert!(chosen.len() >= 3, "the fixture has too few distinct rides");
    let [resolvable, missing, overrun] = [&chosen[0], &chosen[1], &chosen[2]];

    let tracks: BTreeMap<String, Vec<tracematch::GpsPoint>> = {
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
        [resolvable, missing, overrun]
            .iter()
            .map(|(_, ride, _)| (ride.clone(), engine.get_gps_track(ride).expect("a track")))
            .collect()
    };
    let line_of = |ride: &str| tracks[ride][2..30].to_vec();
    give_reference(
        &conn,
        &resolvable.0,
        (&resolvable.1, 2, 30),
        &line_of(&resolvable.1),
    );
    give_reference(&conn, &missing.0, (&missing.1, 2, 30), &line_of(&missing.1));
    let past_the_end = tracks[&overrun.1].len() as u32 + 5;
    give_reference(
        &conn,
        &overrun.0,
        (&overrun.1, 2, past_the_end),
        &line_of(&overrun.1),
    );
    conn.execute("DELETE FROM gps_tracks WHERE activity_id = ?", [&missing.1])
        .expect("the ride is absent");
    let outgoing = count(
        &conn,
        "SELECT COUNT(*) FROM sections
         WHERE section_type = 'auto' AND original_polyline_json IS NULL
           AND is_user_defined = 0 AND disabled = 0",
    );
    conn.execute_batch(
        "CREATE TRIGGER refuse_cutover_diff BEFORE INSERT ON settings
         WHEN NEW.key = '__detector_cutover_diff'
         BEGIN SELECT RAISE(ABORT, 'diff write refused'); END;",
    )
    .expect("refuse the diff write");

    assert!(
        veloqrs::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
            path.to_str().unwrap().to_string()
        )
    );
    assert!(veloqrs::persistence::cutover::run_cutover().is_err());
    let token: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = '__detector_cutover'",
            [],
            |row| row.get(0),
        )
        .expect("token");
    assert!(token.ends_with("-inflight"), "{token}");

    let expect_states = |phase: &str| {
        let archived = archived_states(&conn);
        assert_eq!(
            archived.len() as i64,
            outgoing,
            "{phase}: one state per section"
        );
        let version_of = |id: &str| {
            archived
                .iter()
                .find(|(section, _)| section == id)
                .map(|(_, version)| *version)
                .unwrap_or_else(|| panic!("{phase}: {id} has no archived state"))
        };
        for (id, ride, expected_source) in [
            (&resolvable.0, &resolvable.1, "exact"),
            (&missing.0, &missing.1, "orphaned"),
            (&overrun.0, &overrun.1, "orphaned"),
        ] {
            let version = version_of(id);
            let (source, blob) = geometry_version_row(&conn, id, version);
            assert_eq!(source, expected_source, "{phase}: {id}");
            assert_eq!(
                blob > 0,
                expected_source == "orphaned",
                "{phase}: {id} keeps a line exactly when its range cannot draw it"
            );
            let expected = if expected_source == "exact" {
                line_of(ride)
            } else {
                canonical_line(&line_of(ride))
            };
            assert_eq!(drawn_state(id, version), expected, "{phase}: {id}");
        }
        for (id, version) in &archived {
            assert!(
                drawn_state(id, *version).len() >= 2,
                "{phase}: {id} has no line at version {version}"
            );
        }
        archived
    };
    let first_run = expect_states("after the failed run");

    conn.execute_batch("DROP TRIGGER refuse_cutover_diff")
        .expect("allow the diff write");
    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().expect("the retried run"),
        veloqrs::persistence::cutover::CutoverOutcome::Completed(_)
    ));
    let promoted = expect_states("after the promotion");
    assert_eq!(promoted, first_run, "the retried run reuses the states");
    let version_of = |id: &str| {
        promoted
            .iter()
            .find(|(section, _)| section == id)
            .map(|(_, version)| *version)
            .expect("an archived state")
    };

    veloqrs::persistence::with_persistent_engine(|e| {
        e.add_activity(
            missing.1.clone(),
            tracks[&missing.1].clone(),
            missing.2.clone(),
        )
    })
    .expect("engine")
    .expect("the absent ride syncs");
    let arrived = veloqrs::persistence::with_persistent_engine(|e| e.get_gps_track(&missing.1))
        .expect("engine")
        .expect("the stored ride");
    assert_eq!(
        geometry_version_row(&conn, &missing.0, version_of(&missing.0)),
        ("exact".to_string(), 0),
        "the arrived ride re-slices to the state, so its copy goes"
    );
    assert_eq!(
        drawn_state(&missing.0, version_of(&missing.0)),
        arrived[2..30].to_vec()
    );

    assert!(matches!(
        veloqrs::persistence::cutover::run_cutover().expect("a later launch"),
        veloqrs::persistence::cutover::CutoverOutcome::NotOwed
    ));
    assert_eq!(archived_states(&conn), promoted);
    assert_eq!(
        drawn_state(&missing.0, version_of(&missing.0)),
        arrived[2..30].to_vec()
    );
    assert_eq!(
        drawn_state(&resolvable.0, version_of(&resolvable.0)),
        line_of(&resolvable.1)
    );
    assert_eq!(
        drawn_state(&overrun.0, version_of(&overrun.0)),
        canonical_line(&line_of(&overrun.1))
    );
}

/// Scenario: an athlete named an auto section in 0.3.x and updates.
/// Expected behaviour: the section is pinned at its 0.3.x line when the upgrade
/// promotes its name, so the cutover's cold detect leaves it whole and the name
/// stays on it.
#[test]
fn an_upgraded_named_section_is_pinned_and_survives_the_cutover_whole() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    {
        let conn = Connection::open(&path).unwrap();
        let id: String = conn
            .query_row(
                "SELECT id FROM sections
                 WHERE section_type = 'auto' AND is_user_defined = 0 AND disabled = 0
                 ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("an auto section in the fixture");
        conn.execute(
            "UPDATE sections SET name = 'Tarn hill repeat' WHERE id = ?",
            [&id],
        )
        .unwrap();
    }

    assert!(
        veloqrs::persistence::persistent_engine_ffi::persistent_engine_init_without_owed_work(
            path.to_str().unwrap().to_string()
        )
    );
    let conn = Connection::open(&path).unwrap();
    let pinned_ids: Vec<(String, i64)> = conn
        .prepare("SELECT section_id, version FROM section_pins")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(pinned_ids.len(), 1, "only the named section is pinned");
    let (pinned, version) = pinned_ids[0].clone();
    assert_eq!(version, 1);
    let v1_line =
        veloqrs::persistence::with_persistent_engine(|e| e.section_geometry_polyline(&pinned, 1))
            .expect("engine");
    assert!(
        v1_line.is_some_and(|line| line.len() >= 2),
        "the pinned version has to resolve to a line, by blob or by its triple"
    );
    let line_of = |id: &str| {
        veloqrs::persistence::with_persistent_engine(|e| {
            e.get_section_by_id(id).map(|s| s.polyline)
        })
        .expect("engine")
    };
    let pinned_line = line_of(&pinned).expect("the pinned section survives the open");
    assert!(pinned_line.len() >= 2);

    let outcome = veloqrs::persistence::cutover::run_cutover().expect("cutover");
    assert!(matches!(
        outcome,
        veloqrs::persistence::cutover::CutoverOutcome::Completed(_)
    ));
    let after = Connection::open(&path).unwrap();
    let still_there: i64 = after
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE id = ?",
            [&pinned],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(still_there, 1, "the cutover re-cut the pinned section");
    let line_after = line_of(&pinned).expect("still readable");
    assert_eq!(
        canonical_line(&line_after),
        canonical_line(&pinned_line),
        "the pinned line moved"
    );
    let named: i64 = after
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE kind = 'named' AND name = 'Tarn hill repeat'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(named, 1);
}

/// Scenario: the ranking inputs table arrives empty with every section marked,
/// and the first launch after the upgrade fills it.
///
/// Expected behaviour: nothing stays marked, a row exists for each ranked
/// section and sport, and the ranked sections read from them carry the
/// traversal counts the junction holds.
#[test]
fn upgrading_a_released_v12_database_fills_the_ranking_inputs() {
    let _serial_state = super::serial_state();
    let (_dir, path) = seeded_fixture();
    migrate_only(&path);

    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open");
    engine.load().expect("load");
    drop(engine);

    let after = Connection::open(&path).unwrap();
    assert_eq!(count(&after, "SELECT COUNT(*) FROM section_rank_dirty"), 0);
    assert_eq!(
        count(&after, "SELECT COUNT(*) FROM section_rank_dirty_activity"),
        0
    );
    let stored = count(&after, "SELECT COUNT(*) FROM section_rank_inputs");
    let expected = count(
        &after,
        "SELECT COUNT(*) FROM (
             SELECT sa.section_id, a.sport_type
             FROM section_activities sa
             JOIN sections s ON s.id = sa.section_id
             JOIN activities a ON a.id = sa.activity_id
             JOIN activity_metrics am ON am.activity_id = sa.activity_id
             WHERE sa.excluded = 0 AND sa.lap_time IS NOT NULL
               AND s.disabled = 0 AND s.superseded_by IS NULL
               AND sa.direction != 'partial'
               AND (CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= 0.9
                         WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1
                         ELSE sa.distance_meters >= s.distance_meters * 0.7 END)
             GROUP BY sa.section_id, a.sport_type)",
    );
    assert!(expected > 0, "the fixture has no lap to rank");
    assert_eq!(stored, expected);
}
