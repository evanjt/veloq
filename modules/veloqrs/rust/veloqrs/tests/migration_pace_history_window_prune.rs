//! Scenario: an athlete on the last release holds pace snapshots saved under
//! the year window beside the six-week ones, and one from before windows were
//! recorded.
//!
//! Expected behaviour: the upgrade keeps the six-week and unwindowed rows and
//! drops the rest.

use super::migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

#[test]
fn upgrading_the_released_library_drops_pace_snapshots_outside_the_six_week_window() {
    let _serial_state = super::serial_state();
    let release = latest_release();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    {
        let conn = Connection::open(&path).expect("open fixture");
        conn.execute_batch(release.library.expect("the release has a library"))
            .expect("replay fixture");
        conn.execute("DELETE FROM pace_history", []).expect("clear");
        for (date, window) in [
            (100, Some(42)),
            (200, Some(365)),
            (300, Some(90)),
            (400, None),
        ] {
            conn.execute(
                "INSERT INTO pace_history (date, sport_type, critical_speed, window_days)
                 VALUES (?, 'Run', 3.5, ?)",
                rusqlite::params![date, window],
            )
            .expect("seed snapshot");
        }
    }

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let conn = Connection::open(&path).expect("open after");
    assert_eq!(user_version(&conn), latest_version());
    let mut stmt = conn
        .prepare("SELECT date FROM pace_history ORDER BY date")
        .unwrap();
    let dates: Vec<i64> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(dates, vec![100, 400]);
}
