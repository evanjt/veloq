//! Scenario: a library synced before the sixth and seventh heart rate zone
//! columns existed. Every activity row carries zero there, and the stored zone
//! series that could fill them is gone.
//!
//! Expected behaviour: the upgrade marks owed the download of each activity
//! that has heart rate time in the first five zones and nothing in the last
//! two, so the next sync writes the missing zones. An activity with no heart
//! rate time, one that already has time in either top zone, and one the device
//! never fetched are left as they were.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const ATHLETE: &str = "i1";

fn insert_metrics(conn: &Connection, id: &str, hr: [f64; 7]) {
    conn.execute(
        "INSERT INTO activity_metrics
         (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain,
          sport_type, hr_z1, hr_z2, hr_z3, hr_z4, hr_z5, hr_z6, hr_z7)
         VALUES (?, 'Ride', 1700000000, 1000.0, 600, 600, 0.0, 'Ride',
                 ?, ?, ?, ?, ?, ?, ?)",
        params![id, hr[0], hr[1], hr[2], hr[3], hr[4], hr[5], hr[6]],
    )
    .unwrap();
}

fn insert_census(conn: &Connection, intervals_id: &str, fetched: Option<&str>) {
    conn.execute(
        "INSERT INTO activity_census (athlete_id, intervals_id, icu_sync_date, fetched_sync_date)
         VALUES (?, ?, '2026-01-01T00:00:00', ?)",
        params![ATHLETE, intervals_id, fetched],
    )
    .unwrap();
}

fn insert_activity(conn: &Connection, id: &str, intervals_id: &str) {
    conn.execute(
        "INSERT INTO activities (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng)
         VALUES (?, ?, 'Ride', 0, 0, 0, 0)",
        params![id, intervals_id],
    )
    .unwrap();
}

fn fetched_marks(path: &Path) -> BTreeMap<String, Option<String>> {
    let conn = Connection::open(path).expect("reopen");
    let mut stmt = conn
        .prepare("SELECT intervals_id, fetched_sync_date FROM activity_census")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn an_upgrade_owes_the_download_of_activities_whose_top_zones_were_never_written() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let fetched = Some("2026-01-01T00:00:00".to_string());
    {
        let conn = seed_at_version(&path, 50);
        // Zones one to five only: owed.
        insert_metrics(
            &conn,
            "five_zones",
            [60.0, 120.0, 300.0, 90.0, 30.0, 0.0, 0.0],
        );
        insert_census(&conn, "five_zones", fetched.as_deref());
        // Owed through the activities row that maps a local id to the census id.
        insert_metrics(
            &conn,
            "local_id",
            [60.0, 120.0, 300.0, 90.0, 30.0, 0.0, 0.0],
        );
        insert_activity(&conn, "local_id", "upstream_id");
        insert_census(&conn, "upstream_id", fetched.as_deref());
        // No heart rate time at all: nothing to fill.
        insert_metrics(&conn, "no_hr", [0.0; 7]);
        insert_census(&conn, "no_hr", fetched.as_deref());
        // Already has a top zone: written by a sync after the columns existed.
        insert_metrics(&conn, "has_z6", [60.0, 120.0, 300.0, 90.0, 30.0, 12.0, 0.0]);
        insert_census(&conn, "has_z6", fetched.as_deref());
        insert_metrics(&conn, "has_z7", [60.0, 120.0, 300.0, 90.0, 30.0, 0.0, 5.0]);
        insert_census(&conn, "has_z7", fetched.as_deref());
        // Never fetched: already owed, and stays NULL.
        insert_metrics(
            &conn,
            "unfetched",
            [60.0, 120.0, 300.0, 90.0, 30.0, 0.0, 0.0],
        );
        insert_census(&conn, "unfetched", None);
    }

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let marks = fetched_marks(&path);
    let owed = |id: &str| marks[id].is_none();
    assert!(owed("five_zones"), "zones 1-5 only must be owed");
    assert!(owed("upstream_id"), "owed through the activities mapping");
    assert!(owed("unfetched"), "an unfetched row stays owed");
    assert!(!owed("no_hr"), "no heart rate time has nothing to fill");
    assert!(!owed("has_z6"), "a written zone 6 must not be re-fetched");
    assert!(!owed("has_z7"), "a written zone 7 must not be re-fetched");

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("second launch"));
    assert_eq!(fetched_marks(&path), marks, "a second launch changed marks");
}
