//! Scenario: an athlete whose sport settings list fewer than seven power zones
//! has older rows with time in a power zone column above their last zone, kept
//! there positionally from a list that ended with an extra entry.
//!
//! Expected behaviour: the upgrade owes the download of each fetched activity
//! whose sport entry has fewer zones than the highest power column holding
//! time. A row inside the entry's zones, a sport with seven zones, one with no
//! settings, and one never fetched are left as they were.

use super::migration_support;

use migration_support::*;
use rusqlite::{Connection, params};
use std::collections::BTreeMap;
use std::path::Path;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const ATHLETE: &str = "i1";
const FETCHED: &str = "2026-01-01T00:00:00";

fn insert_ride(conn: &Connection, id: &str, sport: &str, power: [f64; 7], fetched: bool) {
    conn.execute(
        "INSERT INTO activity_metrics
         (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain,
          sport_type, power_z1, power_z2, power_z3, power_z4, power_z5, power_z6, power_z7)
         VALUES (?, 'Ride', 1700000000, 1000.0, 600, 600, 0.0, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id, sport, power[0], power[1], power[2], power[3], power[4], power[5], power[6]
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO activity_census (athlete_id, intervals_id, icu_sync_date, fetched_sync_date)
         VALUES (?, ?, '2026-01-01T00:00:00', ?)",
        params![ATHLETE, id, fetched.then_some(FETCHED)],
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
fn an_upgrade_owes_rows_with_time_above_the_athletes_last_power_zone() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let scripts = PersistentEngine::migration_scripts().len() as u32;
    {
        let conn = seed_at_version(&path, scripts - 1);
        let settings = r#"[
            {"types":["Ride"],"power_zones":[55,75,90,105,120,999]},
            {"types":["VirtualRide"],"power_zones":[55,75,90,105,120,150,999]},
            {"types":["Run"],"power_zones":[80,90,100]}
        ]"#;
        conn.execute(
            "INSERT INTO sport_settings (id, data, updated_at) VALUES ('current', ?, 0)",
            [settings],
        )
        .unwrap();
        let ss = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0];
        let six = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 0.0];
        insert_ride(&conn, "six_zone_overflow", "Ride", ss, true);
        insert_ride(&conn, "six_zone_inside", "Ride", six, true);
        insert_ride(&conn, "seven_zone", "VirtualRide", ss, true);
        insert_ride(&conn, "three_zone_overflow", "Run", six, true);
        insert_ride(&conn, "no_entry", "Swim", ss, true);
        insert_ride(&conn, "unfetched", "Ride", ss, false);
    }

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let marks = fetched_marks(&path);
    let owed = |id: &str| marks[id].is_none();
    assert!(owed("six_zone_overflow"), "Z7 time on six zones is owed");
    assert!(
        owed("three_zone_overflow"),
        "Z6 time on three zones is owed"
    );
    assert!(owed("unfetched"), "an unfetched row stays owed");
    assert!(!owed("six_zone_inside"), "time inside the zones is kept");
    assert!(!owed("seven_zone"), "seven zones hold Z7 time");
    assert!(!owed("no_entry"), "a sport with no settings entry is left");

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("second launch"));
    assert_eq!(fetched_marks(&path), marks, "a second launch changed marks");
}
