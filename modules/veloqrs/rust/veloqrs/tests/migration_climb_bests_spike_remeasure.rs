//! Scenario: an athlete on the last release holds stored climbing bests that
//! were measured before a one-sample elevation spike was refused.
//!
//! Expected behaviour: the upgrade leaves no stored climbing best, so the
//! backfill measures every activity again, and every other row survives.

use super::migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

#[test]
fn upgrading_the_released_library_clears_stored_climb_bests_and_keeps_the_rest() {
    let _serial_state = super::serial_state();
    let release = latest_release();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    {
        let conn = Connection::open(&path).expect("open fixture");
        conn.execute_batch(release.library.expect("the release has a library"))
            .expect("replay fixture");
        conn.execute(
            "INSERT INTO activity_climb_bests (activity_id, window_s, start_idx, end_idx, vam)
             VALUES ('lib-ride-1', 15, 3, 18, 9936.0)",
            [],
        )
        .expect("seed a spiked best");
    }
    let before = {
        let conn = Connection::open(&path).expect("open before");
        (
            row_count(&conn, "activities"),
            row_count(&conn, "sections"),
            row_count(&conn, "settings"),
        )
    };

    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open and migrate"));

    let conn = Connection::open(&path).expect("open after");
    assert_eq!(user_version(&conn), latest_version());
    assert_eq!(row_count(&conn, "activity_climb_bests"), Some(0));
    assert_eq!(
        (
            row_count(&conn, "activities"),
            row_count(&conn, "sections"),
            row_count(&conn, "settings"),
        ),
        before
    );
}
